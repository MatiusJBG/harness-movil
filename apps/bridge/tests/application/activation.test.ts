import { describe, expect, it, vi } from '../helpers/testkit.js'
import { Activation } from '../../src/application/use-cases/activation.js'
import type { Scheduler } from '../../src/application/ports/scheduler.js'
import { createFakeClock, createFakeCookies, createFakeLogger, createFakeSupervisor } from '../helpers/fakes.js'

interface FakeScheduler extends Scheduler {
  tick(): void
  activeTimers(): number
}

function createScheduler(): FakeScheduler {
  const callbacks = new Map<number, () => void>()
  let nextId = 1
  return {
    setInterval(callback) {
      const id = nextId
      nextId += 1
      callbacks.set(id, callback)
      return id
    },
    clearInterval(handle) {
      callbacks.delete(handle as number)
    },
    tick() {
      for (const callback of [...callbacks.values()]) callback()
    },
    activeTimers() {
      return callbacks.size
    },
  }
}

function setup(idleAutoOffMinutes = 30) {
  const clock = createFakeClock()
  const supervisor = createFakeSupervisor()
  const cookies = createFakeCookies()
  const logger = createFakeLogger()
  const scheduler = createScheduler()
  const activation = new Activation({
    supervisor,
    cookies,
    logger,
    clock,
    idleAutoOffMinutes,
    scheduler,
    idleCheckMs: 10,
  })
  return { clock, supervisor, cookies, logger, scheduler, activation }
}

describe('caso de uso: activación del host Harness', () => {
  it('arranca, intercambia la cookie y queda activo', async () => {
    const { activation, supervisor, cookies, logger } = setup()
    expect(activation.state()).toBe('inactive')

    await activation.activate()

    expect(activation.state()).toBe('active')
    expect(activation.isActive()).toBe(true)
    expect(supervisor.startCount).toBe(1)
    expect(cookies.exchangeCount).toBe(1)
    expect(cookies.cookie).toBe('dsh-auth-test=launch-token')
    expect(activation.snapshot()).toMatchObject({ state: 'active', active: true, port: 5173, pid: 4242 })
    expect(logger.entries.some((entry) => entry.message.includes('activa'))).toBe(true)
  })

  it('es idempotente mientras ya está activo', async () => {
    const { activation, supervisor } = setup()
    await activation.activate()
    await activation.activate()
    expect(supervisor.startCount).toBe(1)
  })

  it('serializa dos activaciones concurrentes', async () => {
    const { activation, supervisor } = setup()
    await Promise.all([activation.activate(), activation.activate()])
    expect(supervisor.startCount).toBe(1)
    expect(activation.state()).toBe('active')
  })

  it('si el arranque falla deja estado de error, limpia la cookie y detiene el proceso', async () => {
    const { activation, supervisor, cookies, logger } = setup()
    supervisor.failNextStart = new Error('boom')
    await expect(activation.activate()).rejects.toThrow('boom')

    expect(activation.state()).toBe('error')
    expect(activation.isActive()).toBe(false)
    expect(activation.snapshot().error).toBe('boom')
    expect(supervisor.stopCount).toBe(1)
    expect(cookies.cookie).toBeUndefined()
    expect(logger.entries.some((entry) => entry.level === 'error')).toBe(true)
  })

  it('se recupera después de un fallo', async () => {
    const { activation, supervisor } = setup()
    supervisor.failNextStart = new Error('boom')
    await expect(activation.activate()).rejects.toThrow('boom')
    await activation.activate()
    expect(activation.state()).toBe('active')
  })

  it('pasa a error cuando el host se cae inesperadamente', async () => {
    const { activation, supervisor, cookies } = setup()
    await activation.activate()
    supervisor.emitExit(null)
    expect(activation.state()).toBe('error')
    expect(activation.snapshot().error).toMatch(/se cerró inesperadamente/)
    expect(cookies.cookie).toBeUndefined()
  })

  it('desactivar detiene el host, limpia la cookie y vuelve a inactivo', async () => {
    const { activation, supervisor, cookies } = setup()
    await activation.activate()
    await activation.deactivate('phone')
    expect(activation.state()).toBe('inactive')
    expect(supervisor.stopCount).toBe(1)
    expect(cookies.cookie).toBeUndefined()
    expect(activation.snapshot().port).toBeNull()
  })

  it('desactivar estando inactivo no llama al supervisor', async () => {
    const { activation, supervisor } = setup()
    await activation.deactivate()
    expect(supervisor.stopCount).toBe(0)
    expect(activation.state()).toBe('inactive')
  })

  it('apaga la conexión por inactividad', async () => {
    const { activation, clock, scheduler, supervisor } = setup(1)
    await activation.activate()
    clock.advance(60_001)
    scheduler.tick()
    await vi.waitFor(() => {
      expect(activation.state()).toBe('inactive')
    })
    expect(supervisor.stopCount).toBe(1)
  })

  it('la actividad reinicia el contador de inactividad', async () => {
    const { activation, clock, scheduler } = setup(1)
    await activation.activate()
    clock.advance(59_000)
    activation.touch()
    clock.advance(30_000)
    scheduler.tick()
    expect(activation.state()).toBe('active')
  })

  it('no programa el temporizador cuando el apagado está deshabilitado', async () => {
    const { activation, clock, scheduler } = setup(0)
    await activation.activate()
    expect(scheduler.activeTimers()).toBe(0)
    clock.advance(10 * 60_000)
    scheduler.tick()
    expect(activation.state()).toBe('active')
  })

  it('notifica a los suscriptores cada transición y deja de notificar tras desuscribirse', async () => {
    const { activation } = setup()
    const seen: string[] = []
    const unsubscribe = activation.subscribe((snapshot) => seen.push(snapshot.state))
    await activation.activate()
    expect(seen).toEqual(['starting', 'active'])
    unsubscribe()
    await activation.deactivate()
    expect(seen).toEqual(['starting', 'active'])
  })

  it('dispose deja todo cerrado y no reacciona a una salida posterior', async () => {
    const { activation, supervisor, scheduler } = setup()
    await activation.activate()
    await activation.dispose()
    expect(activation.state()).toBe('inactive')
    expect(scheduler.activeTimers()).toBe(0)
    supervisor.emitExit(null)
    expect(activation.state()).toBe('inactive')
  })

  it('marca actividad solo cuando está activo', async () => {
    const { activation, clock } = setup()
    activation.touch()
    expect(activation.snapshot().lastActivityAt).toBeNull()
    await activation.activate()
    const before = activation.snapshot().lastActivityAt
    clock.advance(1_000)
    activation.touch()
    expect(activation.snapshot().lastActivityAt).toBe((before ?? 0) + 1_000)
  })
})
