import { afterEach, describe, expect, it, vi } from './helpers/testkit.js'
import { Activation } from '../src/activation.js'
import type { DshStartInfo } from '../src/dsh.js'
import { silentLogger } from './helpers/logger.js'

interface Harness {
  activation: Activation
  supervisor: {
    start: ReturnType<typeof vi.fn>
    stop: ReturnType<typeof vi.fn>
    running: ReturnType<typeof vi.fn>
    onExit: (listener: (info: DshStartInfo | null) => void) => () => void
    exit: (info: DshStartInfo | null) => void
  }
  jar: { exchange: ReturnType<typeof vi.fn>; clear: ReturnType<typeof vi.fn>; header: () => string | undefined }
}

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
})

function build(options: { failStart?: boolean; idleAutoOffMinutes?: number } = {}): Harness {
  const listeners = new Set<(info: DshStartInfo | null) => void>()
  const info: DshStartInfo = { pid: 42, port: 5555, token: 'token', startedAt: 1, command: 'dsh' }
  const supervisor = {
    start: options.failStart
      ? vi.fn(async () => {
          throw new Error('boom')
        })
      : vi.fn(async () => info),
    stop: vi.fn(async () => undefined),
    running: vi.fn(() => true),
    onExit: (listener: (info: DshStartInfo | null) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    exit: (value: DshStartInfo | null) => {
      for (const listener of listeners) listener(value)
    },
  }
  const jar = {
    exchange: vi.fn(async () => undefined),
    clear: vi.fn(),
    header: () => 'cookie',
  }
  const activation = new Activation({
    supervisor,
    jar,
    logger: silentLogger,
    idleAutoOffMinutes: options.idleAutoOffMinutes ?? 0,
  })
  cleanups.push(() => activation.dispose())
  return { activation, supervisor, jar }
}

describe('Activation', () => {
  it('starts the host, exchanges the token and becomes active', async () => {
    const harness = build()
    expect(harness.activation.state).toBe('inactive')
    await harness.activation.activate()
    expect(harness.activation.state).toBe('active')
    expect(harness.activation.isActive()).toBe(true)
    expect(harness.supervisor.start).toHaveBeenCalledTimes(1)
    expect(harness.jar.exchange).toHaveBeenCalledWith({ port: 5555, token: 'token' })
    const snapshot = harness.activation.snapshot()
    expect(snapshot.port).toBe(5555)
    expect(snapshot.pid).toBe(42)
    expect(snapshot.lastActivityAt).not.toBeNull()
  })

  it('is idempotent while active', async () => {
    const harness = build()
    await harness.activation.activate()
    await harness.activation.activate()
    expect(harness.supervisor.start).toHaveBeenCalledTimes(1)
  })

  it('deactivates, stops the host and clears the cookie', async () => {
    const harness = build()
    await harness.activation.activate()
    await harness.activation.deactivate()
    expect(harness.activation.state).toBe('inactive')
    expect(harness.supervisor.stop).toHaveBeenCalledTimes(1)
    expect(harness.jar.clear).toHaveBeenCalled()
  })

  it('reports an error and stops the host when startup fails', async () => {
    const harness = build({ failStart: true })
    await expect(harness.activation.activate()).rejects.toThrow('boom')
    expect(harness.activation.state).toBe('error')
    expect(harness.activation.snapshot().error).toContain('boom')
    expect(harness.supervisor.stop).toHaveBeenCalled()
    expect(harness.jar.clear).toHaveBeenCalled()
  })

  it('moves to error when the host exits unexpectedly', async () => {
    const harness = build()
    await harness.activation.activate()
    harness.supervisor.exit({
      pid: 42,
      port: 5555,
      token: 't',
      startedAt: 1,
      command: 'dsh',
    })
    expect(harness.activation.state).toBe('error')
    expect(harness.activation.snapshot().error).toContain('cerró')
    expect(harness.jar.clear).toHaveBeenCalled()
  })

  it('turns off after the idle window', async () => {
    let now = 1_000_000
    const harness = build({ idleAutoOffMinutes: 1 })
    const activation = new Activation({
      supervisor: harness.supervisor,
      jar: harness.jar,
      logger: silentLogger,
      idleAutoOffMinutes: 1,
      idleCheckMs: 5,
      now: () => now,
    })
    cleanups.push(() => activation.dispose())
    await activation.activate()
    expect(activation.state).toBe('active')
    now += 61_000
    await new Promise((resolve) => setTimeout(resolve, 40))
    await vi.waitFor(() => {
      expect(activation.state).toBe('inactive')
    })
  })

  it('notifies subscribers of state changes', async () => {
    const harness = build()
    const states: string[] = []
    const unsubscribe = harness.activation.subscribe((snapshot) => states.push(snapshot.state))
    await harness.activation.activate()
    await harness.activation.deactivate()
    unsubscribe()
    expect(states).toEqual(['starting', 'active', 'stopping', 'inactive'])
  })
})
