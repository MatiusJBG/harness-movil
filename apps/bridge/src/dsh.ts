import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import type { ResolvedConfig } from './config.js'
import type { Logger } from './log.js'
import { scrubString } from './log.js'

export const TOKEN_RE = /[?&]token=([A-Za-z0-9._~-]+)/

export interface DshStartInfo {
  pid: number
  port: number
  token: string
  startedAt: number
  command: string
}

export class DshStartError extends Error {
  override name = 'DshStartError'
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message)
  }
}

/** The printed URL carries the process token; the host may be the advertised public URL. */
export function parseToken(text: string): string | null {
  const match = TOKEN_RE.exec(text)
  return match?.[1] ?? null
}

/** Reserves an ephemeral loopback port and releases it right before dsh binds it. */
export function pickFreePort(host = '127.0.0.1'): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, host, () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => {
        if (port > 0) resolve(port)
        else reject(new Error('No se pudo reservar un puerto loopback'))
      })
    })
  })
}

function findOnPath(name: string, env: NodeJS.ProcessEnv): string | null {
  const pathValue = env.PATH ?? env.Path ?? ''
  const extensions = process.platform === 'win32' ? ['.cmd', '.exe', '.bat', ''] : ['']
  for (const directory of pathValue.split(delimiter)) {
    if (directory.trim() === '') continue
    for (const extension of extensions) {
      const candidate = join(directory, `${name}${extension}`)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

export function resolveDshCommand(config: ResolvedConfig, env: NodeJS.ProcessEnv = process.env): string {
  const configured = config.config.dsh.command
  if (configured !== 'auto') {
    if (existsSync(configured)) return configured
    const onPath = findOnPath(configured, env)
    if (onPath) return onPath
    throw new DshStartError(
      `No se encontró el comando dsh configurado ("${configured}"). Corregí dsh.command en config.json.`,
    )
  }

  const onPath = findOnPath('dsh', env)
  if (onPath) return onPath

  const localAppData = env.LOCALAPPDATA ?? ''
  const bundled = [
    join(localAppData, 'Programs', 'DeepSeek Harness', 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd'),
    join(env.ProgramFiles ?? 'C:\\Program Files', 'DeepSeek Harness', 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd'),
  ].find((candidate) => candidate !== '' && existsSync(candidate))
  if (bundled) return bundled

  throw new DshStartError(
    'No se encontró dsh. Instalá el CLI de DeepSeek Harness, agregalo al PATH o fijá dsh.command en config.json.',
  )
}

export interface BuildDshArgsOptions {
  profile: string
  profileDir: string
  port: number
  publicUrl: string
  extraArgs: string[]
  profileExists: boolean
}

export function buildDshArgs(options: BuildDshArgsOptions): string[] {
  const args: string[] = [options.profile]
  if (!options.profileExists) args.push('--from-default-profile', 'web')
  args.push('--no-open', '--host', '127.0.0.1', '--port', String(options.port), '--public-url', options.publicUrl)
  args.push(...options.extraArgs)
  return args
}

function quoteWindowsArg(value: string): string {
  if (value === '') return '""'
  if (!/[\s"&|<>^]/.test(value)) return value
  return `"${value.replace(/"/g, '""')}"`
}

export interface SpawnCommand {
  file: string
  args: string[]
  windowsVerbatimArguments?: boolean
}

/** Windows `.cmd`/`.bat` files need cmd.exe; everything else spawns directly. */
export function toSpawnCommand(command: string, args: string[]): SpawnCommand {
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(command)) {
    const line = [quoteWindowsArg(command), ...args.map(quoteWindowsArg)].join(' ')
    return {
      file: process.env.ComSpec ?? 'cmd.exe',
      args: ['/d', '/s', '/c', `"${line}"`],
      windowsVerbatimArguments: true,
    }
  }
  return { file: command, args }
}

export interface SupervisorDeps {
  spawnImpl?: typeof spawn
  env?: NodeJS.ProcessEnv
  now?: () => number
  killTree?: (pid: number) => Promise<void>
  cwd?: string
  findPort?: () => Promise<number>
}

export interface DshSupervisorOptions {
  config: ResolvedConfig
  logger: Logger
  deps?: SupervisorDeps
}

export class DshSupervisor {
  private child: ChildProcess | null = null
  private info: DshStartInfo | null = null
  private stopping = false
  private readonly exitListeners = new Set<(info: DshStartInfo | null) => void>()
  private readonly spawnImpl: typeof spawn
  private readonly env: NodeJS.ProcessEnv
  private readonly now: () => number
  private readonly cwd: string
  private readonly findPort: () => Promise<number>

  constructor(private readonly options: DshSupervisorOptions) {
    const deps = options.deps ?? {}
    this.spawnImpl = deps.spawnImpl ?? spawn
    this.env = { ...(deps.env ?? process.env) }
    this.now = deps.now ?? (() => Date.now())
    this.cwd = deps.cwd ?? homedir()
    this.findPort = deps.findPort ?? (() => pickFreePort())
  }

  running(): boolean {
    return this.child !== null && this.info !== null
  }

  current(): DshStartInfo | null {
    return this.info
  }

  onExit(listener: (info: DshStartInfo | null) => void): () => void {
    this.exitListeners.add(listener)
    return () => this.exitListeners.delete(listener)
  }

  async start(): Promise<DshStartInfo> {
    if (this.child && this.info) return this.info
    const { config, logger } = this.options
    const shellLogger = logger.child({ component: 'dsh' })
    const command = resolveDshCommand(config, this.env)
    const profileDir = join(config.dshHome, 'profiles', config.config.dsh.profile)
    const port = await this.findPort()
    const args = buildDshArgs({
      profile: config.config.dsh.profile,
      profileDir,
      port,
      publicUrl: config.publicUrl,
      extraArgs: config.config.dsh.extraArgs,
      profileExists: existsSync(profileDir),
    })
    const spawnCommand = toSpawnCommand(command, args)

    shellLogger.info('arrancando host Harness', { command, profile: config.config.dsh.profile })

    return await new Promise<DshStartInfo>((resolve, reject) => {
      let settled = false
      let buffer = ''
      const child = this.spawnImpl(spawnCommand.file, spawnCommand.args, {
        cwd: this.cwd,
        env: {
          ...this.env,
          DSH_HOME: config.dshHome,
          NO_COLOR: '1',
          FORCE_COLOR: '0',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        windowsVerbatimArguments: spawnCommand.windowsVerbatimArguments,
      })
      this.child = child
      this.stopping = false

      const timeout = setTimeout(() => {
        if (settled) return
        settled = true
        void this.stop().finally(() => {
          reject(
            new DshStartError(
              `El host Harness no arrancó en ${Math.round(config.config.dsh.startTimeoutMs / 1000)} s.`,
              lastLines(buffer),
            ),
          )
        })
      }, config.config.dsh.startTimeoutMs)

      const onChunk = (chunk: Buffer, stream: 'stdout' | 'stderr') => {
        const text = chunk.toString('utf8')
        buffer += text
        if (buffer.length > 32_768) buffer = buffer.slice(-32_768)
        for (const line of text.split(/\r?\n/)) {
          if (line.trim() === '') continue
          const safe = scrubString(line)
          if (stream === 'stderr') shellLogger.debug('dsh stderr', { line: safe })
          else shellLogger.debug('dsh stdout', { line: safe })
          const token = parseToken(line)
          if (token && !settled) {
            settled = true
            clearTimeout(timeout)
            this.info = {
              pid: child.pid ?? -1,
              port,
              token,
              startedAt: this.now(),
              command,
            }
            shellLogger.info('host Harness listo', { port, pid: this.info.pid })
            resolve(this.info)
          }
        }
      }

      child.stdout?.on('data', (chunk: Buffer) => onChunk(chunk, 'stdout'))
      child.stderr?.on('data', (chunk: Buffer) => onChunk(chunk, 'stderr'))

      child.once('error', (error) => {
        if (settled) {
          shellLogger.error('el host Harness falló después de arrancar', { error: error.message })
          this.handleExit()
          return
        }
        settled = true
        clearTimeout(timeout)
        reject(new DshStartError(`No se pudo ejecutar dsh: ${error.message}`))
      })

      child.once('exit', (code, signal) => {
        clearTimeout(timeout)
        if (!settled) {
          settled = true
          reject(
            new DshStartError(
              `El host Harness terminó antes de estar listo (código ${String(code)}, señal ${String(signal)}).`,
              lastLines(buffer),
            ),
          )
        }
        this.handleExit()
      })
    })
  }

  async stop(): Promise<void> {
    const child = this.child
    if (!child || child.pid === undefined) {
      this.child = null
      this.info = null
      return
    }
    this.stopping = true
    const pid = child.pid
    const killTree = this.options.deps?.killTree ?? defaultKillTree
    try {
      await killTree(pid)
    } catch {
      try {
        child.kill('SIGKILL')
      } catch {
        // already gone
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
          // ignore
        }
        resolve()
      }, 5_000)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
    this.child = null
    this.info = null
    this.stopping = false
  }

  private handleExit(): void {
    const ended = this.info
    this.child = null
    this.info = null
    if (this.stopping) return
    for (const listener of this.exitListeners) listener(ended)
  }
}

function lastLines(buffer: string): string {
  const lines = buffer.split(/\r?\n/).filter((line) => line.trim() !== '')
  return scrubString(lines.slice(-6).join('\n')).slice(0, 2_000)
}

async function defaultKillTree(pid: number): Promise<void> {
  if (process.platform !== 'win32') {
    process.kill(pid, 'SIGTERM')
    return
  }
  await new Promise<void>((resolve) => {
    const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    })
    killer.once('exit', () => resolve())
    killer.once('error', () => resolve())
  })
}
