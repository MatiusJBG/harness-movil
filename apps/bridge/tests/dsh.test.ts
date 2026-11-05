import { EventEmitter } from 'node:events'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from './helpers/testkit.js'
import {
  DshStartError,
  DshSupervisor,
  OVERLAY_PATCH_FILE,
  buildDshArgs,
  buildSessionsPatch,
  ensureOverlayPatch,
  extractAgentDefaultModel,
  parseToken,
  resolveDshCommand,
  toSpawnCommand,
} from '../src/dsh.js'
import type { ResolvedConfig } from '../src/config.js'
import { makeTempDir, removeTempDir } from './helpers/fs.js'
import { silentLogger } from './helpers/logger.js'

const dirs: string[] = []

async function tempDir(prefix: string): Promise<string> {
  const dir = await makeTempDir(prefix)
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(removeTempDir))
})

function fakeConfig(command: string): ResolvedConfig {
  return {
    publicUrl: 'https://192.168.1.44:8443/',
    dshHome: 'C:\\dsh',
    dataDir: 'C:\\data',
    config: {
      dsh: {
        command,
        profile: 'mobile',
        home: null,
        sessions: 'isolated',
        extraArgs: [],
        startTimeoutMs: 90_000,
      },
    },
  } as unknown as ResolvedConfig
}

class FakeChild extends EventEmitter {
  pid = 4242
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  exitCode: number | null = null
  kill(): void {
    this.exitCode = 0
  }
}

describe('parseToken', () => {
  it('extracts the token from loopback and advertised URLs', () => {
    expect(parseToken('dsh web: http://127.0.0.1:3091/?token=GNpIvI9dTwgD3WEf_ya-1')).toBe(
      'GNpIvI9dTwgD3WEf_ya-1',
    )
    expect(parseToken('dsh web: https://192.168.1.44:8443/?token=abc_123')).toBe('abc_123')
  })

  it('ignores lines without a token', () => {
    expect(parseToken('dsh web: ready')).toBeNull()
    expect(parseToken('token=missing-question-mark')).toBeNull()
  })
})

describe('buildDshArgs', () => {
  it('passes the loopback bind, the advertised URL and extra args', () => {
    const args = buildDshArgs({
      profile: 'mobile',
      profileDir: 'C:\\dsh\\profiles\\mobile',
      port: 4567,
      publicUrl: 'https://192.168.1.44:8443/',
      extraArgs: ['--verbose'],
      profileExists: true,
      patches: ['C:\\data\\sessions-mobile.patch.yml'],
    })
    expect(args[0]).toBe('mobile')
    expect(args).not.toContain('--from-default-profile')
    expect(args).toContain('--no-open')
    expect(args).toContain('--port')
    expect(args).toContain('4567')
    expect(args).toContain('--public-url')
    expect(args).toContain('https://192.168.1.44:8443/')
    expect(args).toContain('--patch')
    expect(args).toContain('C:\\data\\sessions-mobile.patch.yml')
    expect(args.at(-1)).toBe('--verbose')
  })

  it('creates the profile from the web template when missing', () => {
    const args = buildDshArgs({
      profile: 'mobile',
      profileDir: 'C:\\dsh\\profiles\\mobile',
      port: 4567,
      publicUrl: 'https://x/',
      extraArgs: [],
      profileExists: false,
    })
    expect(args.slice(0, 3)).toEqual(['mobile', '--from-default-profile', 'web'])
  })
})

describe('resolveDshCommand', () => {
  it('uses a configured existing command', async () => {
    const dir = await tempDir('cmd-')
    const file = join(dir, 'custom-dsh.exe')
    await writeFile(file, '')
    expect(resolveDshCommand(fakeConfig(file), {})).toBe(file)
  })

  it('rejects a configured command that cannot be found', () => {
    expect(() => resolveDshCommand(fakeConfig('nope-not-here'), { PATH: '' })).toThrow(DshStartError)
  })

  it('finds dsh on PATH', async () => {
    const dir = await tempDir('path-')
    const executable = process.platform === 'win32' ? 'dsh.cmd' : 'dsh'
    await writeFile(join(dir, executable), '')
    const found = resolveDshCommand(fakeConfig('auto'), { PATH: dir })
    expect(found).toBe(join(dir, executable))
  })

  it('falls back to the bundled Desktop CLI', async () => {
    const dir = await tempDir('bundled-')
    const bin = join(dir, 'Programs', 'DeepSeek Harness', 'resources', 'runtime', 'cli', 'bin')
    await mkdir(bin, { recursive: true })
    const executable = join(bin, 'dsh.cmd')
    await writeFile(executable, '')
    const found = resolveDshCommand(fakeConfig('auto'), {
      PATH: '',
      LOCALAPPDATA: dir,
      ProgramFiles: join(dir, 'none'),
    })
    expect(found).toBe(executable)
  })

  it('throws with an actionable message when nothing is available', () => {
    expect(() =>
      resolveDshCommand(fakeConfig('auto'), { PATH: '', LOCALAPPDATA: '', ProgramFiles: '' }),
    ).toThrow(/No se encontró dsh/)
  })
})

describe('toSpawnCommand', () => {
  it('wraps .cmd files with cmd.exe on Windows', () => {
    if (process.platform !== 'win32') return
    const command = toSpawnCommand('C:\\Program Files\\DeepSeek Harness\\dsh.cmd', ['mobile', '--no-open'])
    expect(command.file.toLowerCase()).toContain('cmd')
    expect(command.args.slice(0, 3)).toEqual(['/d', '/s', '/c'])
    expect(command.windowsVerbatimArguments).toBe(true)
    expect(command.args[3]).toContain('"C:\\Program Files\\DeepSeek Harness\\dsh.cmd"')
  })

  it('spawns executables directly', () => {
    const command = toSpawnCommand('C:\\tools\\dsh.exe', ['--help'])
    expect(command.file).toBe('C:\\tools\\dsh.exe')
    expect(command.args).toEqual(['--help'])
    expect(command.windowsVerbatimArguments).toBeUndefined()
  })
})

const MODEL_BLOCK = [
  '- id: agent-default-model',
  '  name: "@deepseek-ai/dsh-agent-default-model"',
  '  config:',
  '    provider: deepseek-account',
  '    model: deepseek-flash',
  '    reasoningEffort: high',
].join('\n')

async function writeDesktopPatch(dir: string): Promise<void> {
  const folder = join(dir, 'profiles', 'desktop')
  await mkdir(folder, { recursive: true })
  await writeFile(join(folder, 'cordis.patch.yml'), `${MODEL_BLOCK}\n`, 'utf8')
}

describe('extractAgentDefaultModel', () => {
  it('copies the agent-default-model row verbatim and stops at the next entry', () => {
    expect(extractAgentDefaultModel(`${MODEL_BLOCK}\n- id: other\n  name: x\n`)).toBe(MODEL_BLOCK)
    expect(extractAgentDefaultModel('[]')).toBeNull()
  })
})

describe('ensureOverlayPatch', () => {
  it('isolates the session root and mirrors the desktop default model', async () => {
    const dir = await tempDir('patch-')
    const config = fakeConfig('dsh')
    ;(config as unknown as { dataDir: string }).dataDir = dir
    ;(config as unknown as { dshHome: string }).dshHome = dir
    await writeDesktopPatch(dir)

    const file = await ensureOverlayPatch(config)
    expect(file).toBe(join(dir, OVERLAY_PATCH_FILE))
    const content = await readFile(file!, 'utf8')
    expect(content).toContain(buildSessionsPatch())
    expect(content).toContain('agent-default-model')
    expect(content).toContain('provider: deepseek-account')
  })

  it('still mirrors the model when sessions are shared', async () => {
    const dir = await tempDir('patch-shared-')
    const config = fakeConfig('dsh')
    ;(config as unknown as { dataDir: string }).dataDir = dir
    ;(config as unknown as { dshHome: string }).dshHome = dir
    ;(config as unknown as { config: { dsh: { sessions: string } } }).config.dsh.sessions = 'shared'
    await writeDesktopPatch(dir)

    const file = await ensureOverlayPatch(config)
    const content = await readFile(file!, 'utf8')
    expect(content).toContain('agent-default-model')
    expect(content).not.toContain('sessions-mobile')
  })

  it('returns null when there is nothing to overlay', async () => {
    const dir = await tempDir('patch-empty-')
    const config = fakeConfig('dsh')
    ;(config as unknown as { dataDir: string }).dataDir = dir
    ;(config as unknown as { dshHome: string }).dshHome = dir
    ;(config as unknown as { config: { dsh: { sessions: string } } }).config.dsh.sessions = 'shared'
    expect(await ensureOverlayPatch(config)).toBeNull()
  })
})

describe('DshSupervisor', () => {
  it('uses a reserved loopback port and reads the token from the advertised URL', async () => {
    const dir = await tempDir('supervisor-')
    const executable = join(dir, 'node.exe')
    await writeFile(executable, '')
    const config = fakeConfig(executable)
    ;(config as unknown as { dshHome: string }).dshHome = dir
    ;(config as unknown as { dataDir: string }).dataDir = dir
    let captured: { file: string; args: string[]; options: { env: NodeJS.ProcessEnv } } | null = null
    let child: FakeChild | null = null
    const supervisor = new DshSupervisor({
      config,
      logger: silentLogger,
      deps: {
        env: {},
        cwd: dir,
        findPort: async () => 4567,
        killTree: async () => {
          if (child) {
            child.exitCode = 0
            child.emit('exit', 0, null)
          }
        },
        spawnImpl: ((file: string, args: string[], options: { env: NodeJS.ProcessEnv }) => {
          captured = { file, args, options }
          child = new FakeChild()
          const current = child
          setImmediate(() => {
            current.stdout.emit('data', Buffer.from('dsh web: https://192.168.1.44:8443/?token=tok_123\n'))
          })
          return current as unknown as ReturnType<typeof import('node:child_process').spawn>
        }) as unknown as typeof import('node:child_process').spawn,
      },
    })

    const info = await supervisor.start()
    expect(info).toMatchObject({ port: 4567, token: 'tok_123', command: executable })
    expect(supervisor.running()).toBe(true)
    expect(captured!.args).toContain('4567')
    expect(captured!.args).toContain('https://192.168.1.44:8443/')
    expect(captured!.args).toContain('--patch')
    const patchPath = join(dir, OVERLAY_PATCH_FILE)
    expect(captured!.args).toContain(patchPath)
    expect(await readFile(patchPath, 'utf8')).toContain('sessions-mobile')
    expect(captured!.options.env.DSH_HOME).toBe(dir)
    await supervisor.stop()
    expect(supervisor.running()).toBe(false)
  })
})
