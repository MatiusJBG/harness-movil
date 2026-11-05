import { spawn, type ChildProcess } from 'node:child_process'
import type { Readable } from 'node:stream'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { HarnessStartError } from '../../application/errors.js'
import type { HarnessLaunch, HarnessSupervisor } from '../../application/ports/harness-supervisor.js'
import type { Logger } from '../../application/ports/logger.js'
import type { HarnessSettings } from '../../application/ports/settings.js'
import { extractLaunchToken } from '../../domain/harness/launch-token.js'
import { scrubString } from '../shared/redaction.js'
import { resolveDshCommand } from './cli-locator.js'
import { pickFreePort } from './free-port.js'
import { buildDshArgs, toSpawnCommand, type SpawnCommand } from './launch-args.js'
import { ensureOverlayPatch } from './overlay-patch.js'
import { killTree as defaultKillTree } from './windows-kill-tree.js'

export interface SupervisorDeps {
  readonly spawnImpl?: typeof spawn
  readonly env?: NodeJS.ProcessEnv
  readonly now?: () => number
  readonly killTree?: (pid: number) => Promise<void>
  readonly cwd?: string
  readonly findPort?: () => Promise<number>
}

export interface DshSupervisorOptions {
  readonly settings: HarnessSettings
  readonly dataDir: string
  readonly dshHome: string
  readonly publicUrl: string
  readonly logger: Logger
  readonly deps?: SupervisorDeps
}

const MAX_OUTPUT_BUFFER = 32_768
const STOP_TIMEOUT_MS = 5_000

/**
 * Con `stdio: ['ignore','pipe','pipe']` los dos streams siempre existen; el
 * tipo de `ChildProcess` los declara nullables por los otros modos de spawn.
 */
function pipedStreams(child: ChildProcess): { stdout: Readable; stderr: Readable } {
  return child as ChildProcess & { stdout: Readable; stderr: Readable }
}

function appendBuffer(buffer: string, text: string): string {
  const next = buffer + text
  return next.length > MAX_OUTPUT_BUFFER ? next.slice(-MAX_OUTPUT_BUFFER) : next
}

function describeExit(code: number | null, signal: NodeJS.Signals | null, buffer: string): HarnessStartError {
  return new HarnessStartError(
    `El host Harness terminó antes de estar listo (código ${String(code)}, señal ${String(signal)}).`,
    lastLines(buffer),
  )
}

function lastLines(buffer: string): string {
  const lines = buffer.split(/\r?\n/).filter((line) => line.trim() !== '')
  return scrubString(lines.slice(-6).join('\n')).slice(0, 2_000)
}

/** Arranca `dsh web` en loopback, extrae el token del stdout y lo apaga entero. */
export class DshProcessSupervisor implements HarnessSupervisor {
  private child: ChildProcess | null = null
  private launch: HarnessLaunch | null = null
  private stopping = false
  private readonly exitListeners = new Set<(last: HarnessLaunch | null) => void>()
  private readonly spawnImpl: typeof spawn
  private readonly env: NodeJS.ProcessEnv
  private readonly now: () => number
  private readonly cwd: string
  private readonly findPort: () => Promise<number>

  constructor(private readonly options: DshSupervisorOptions) {
    const deps = options.deps ?? {}
    this.spawnImpl = deps.spawnImpl ?? spawn
    this.env = { ...(deps.env ?? process.env) }
    this.now = deps.now ?? ((): number => Date.now())
    this.cwd = deps.cwd ?? homedir()
    this.findPort = deps.findPort ?? ((): Promise<number> => pickFreePort())
  }

  isRunning(): boolean {
    return this.child !== null && this.launch !== null
  }

  onExit(listener: (last: HarnessLaunch | null) => void): () => void {
    this.exitListeners.add(listener)
    return () => {
      this.exitListeners.delete(listener)
    }
  }

  async start(): Promise<HarnessLaunch> {
    if (this.child !== null && this.launch !== null) return this.launch
    const prepared = await this.prepare()
    this.options.logger.child({ component: 'dsh' }).info('arrancando host Harness', {
      command: prepared.command,
      profile: this.options.settings.profile,
      sessions: this.options.settings.sessions,
    })
    const child = this.spawnImpl(prepared.spawnCommand.file, prepared.spawnCommand.args, {
      cwd: this.cwd,
      env: { ...this.env, DSH_HOME: this.options.dshHome, NO_COLOR: '1', FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      windowsVerbatimArguments: prepared.spawnCommand.windowsVerbatimArguments,
    })
    this.child = child
    this.stopping = false
    return await this.awaitReady(child, prepared.command, prepared.port)
  }

  async stop(): Promise<void> {
    const child = this.child
    if (child?.pid === undefined) {
      this.child = null
      this.launch = null
      return
    }
    this.stopping = true
    const pid = child.pid
    const killImpl = this.options.deps?.killTree ?? defaultKillTree
    try {
      await killImpl(pid)
    } catch {
      try {
        child.kill('SIGKILL')
      } catch {
        // ya no existe
      }
    }
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null) {
        resolve()
        return
      }
      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          // ignorar
        }
        resolve()
      }, STOP_TIMEOUT_MS)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
    this.child = null
    this.launch = null
    this.stopping = false
  }

  private async prepare(): Promise<{ command: string; port: number; spawnCommand: SpawnCommand }> {
    const { settings } = this.options
    const command = resolveDshCommand({ command: settings.command }, this.env)
    const profileDir = join(this.options.dshHome, 'profiles', settings.profile)
    const port = await this.findPort()
    const patch = await ensureOverlayPatch({
      dataDir: this.options.dataDir,
      dshHome: this.options.dshHome,
      sessions: settings.sessions,
    })
    const args = buildDshArgs({
      profile: settings.profile,
      port,
      publicUrl: this.options.publicUrl,
      extraArgs: settings.extraArgs,
      profileExists: existsSync(profileDir),
      patches: patch === null ? [] : [patch],
    })
    return { command, port, spawnCommand: toSpawnCommand(command, args) }
  }

  private async awaitReady(child: ChildProcess, command: string, port: number): Promise<HarnessLaunch> {
    const { settings } = this.options
    const shellLogger = this.options.logger.child({ component: 'dsh' })
    return await new Promise<HarnessLaunch>((resolve, reject) => {
      let settled = false
      let buffer = ''

      const timeout = setTimeout(() => {
        if (settled) return
        settled = true
        void this.stop().finally(() => {
          reject(
            new HarnessStartError(
              `El host Harness no arrancó en ${String(Math.round(settings.startTimeoutMs / 1_000))} s.`,
              lastLines(buffer),
            ),
          )
        })
      }, settings.startTimeoutMs)

      const onChunk = (chunk: Buffer, stream: 'stdout' | 'stderr'): void => {
        const text = chunk.toString('utf8')
        buffer = appendBuffer(buffer, text)
        for (const line of text.split(/\r?\n/)) {
          if (line.trim() === '') continue
          shellLogger.debug(stream === 'stderr' ? 'dsh stderr' : 'dsh stdout', { line: scrubString(line) })
          const token = extractLaunchToken(line)
          if (token === null || settled) continue
          settled = true
          clearTimeout(timeout)
          this.launch = { pid: child.pid ?? -1, port, token, startedAt: this.now(), command }
          shellLogger.info('host Harness listo', { port, pid: this.launch.pid })
          resolve(this.launch)
        }
      }

      const streams = pipedStreams(child)
      streams.stdout.on('data', (chunk: Buffer) => {
        onChunk(chunk, 'stdout')
      })
      streams.stderr.on('data', (chunk: Buffer) => {
        onChunk(chunk, 'stderr')
      })

      child.once('error', (error) => {
        if (settled) {
          shellLogger.error('el host Harness falló después de arrancar', { error: error.message })
          this.handleExit()
          return
        }
        settled = true
        clearTimeout(timeout)
        reject(new HarnessStartError(`No se pudo ejecutar dsh: ${error.message}`))
      })

      child.once('exit', (code, signal) => {
        clearTimeout(timeout)
        if (!settled) {
          settled = true
          reject(describeExit(code, signal, buffer))
        }
        this.handleExit()
      })
    })
  }

  private handleExit(): void {
    const ended = this.launch
    this.child = null
    this.launch = null
    if (this.stopping) return
    for (const listener of this.exitListeners) listener(ended)
  }
}
