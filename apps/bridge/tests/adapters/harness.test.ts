import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { describe, expect, it } from '../helpers/testkit.js'
import { findOnPath, resolveDshCommand } from '../../src/adapters/harness/cli-locator.js'
import { pickFreePort } from '../../src/adapters/harness/free-port.js'
import { buildDshArgs, toSpawnCommand } from '../../src/adapters/harness/launch-args.js'
import { buildSessionsPatch, ensureOverlayPatch, extractAgentDefaultModel } from '../../src/adapters/harness/overlay-patch.js'
import { HarnessStartError } from '../../src/application/errors.js'
import { makeTempDir, removeTempDir } from '../helpers/fs.js'

async function withDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await makeTempDir('harness-')
  try {
    return await run(dir)
  } finally {
    await removeTempDir(dir)
  }
}

describe('localizador del CLI', () => {
  it('encuentra el ejecutable en PATH', async () => {
    await withDir(async (dir) => {
      await writeFile(join(dir, 'dsh'), 'bin', 'utf8')
      const found = findOnPath('dsh', { PATH: dir })
      expect(found).toBe(join(dir, 'dsh'))
      expect(findOnPath('no-existe', { PATH: dir })).toBeNull()
    })
  })

  it('resuelve auto, ruta explícita y errores accionables', async () => {
    await withDir(async (dir) => {
      await writeFile(join(dir, 'dsh'), 'bin', 'utf8')
      expect(resolveDshCommand({ command: 'auto' }, { PATH: dir })).toBe(join(dir, 'dsh'))
      expect(resolveDshCommand({ command: join(dir, 'dsh') }, {})).toBe(join(dir, 'dsh'))
      expect(() => resolveDshCommand({ command: 'no-existe' }, { PATH: dir })).toThrow(HarnessStartError)
      expect(() => resolveDshCommand({ command: 'auto' }, { PATH: '' })).toThrow('No se encontró dsh')
    })
  })

  it('respeta el separador de PATH del sistema', () => {
    const empty = ''
    expect(findOnPath('dsh', { PATH: `${empty}${delimiter}${empty}` })).toBeNull()
  })
})

describe('argumentos de lanzamiento', () => {
  it('compone perfil, patch, loopback y extraArgs en orden', () => {
    const args = buildDshArgs({
      profile: 'mobile',
      port: 5173,
      publicUrl: 'https://192.168.1.50:8443/',
      extraArgs: ['--verbose'],
      profileExists: false,
      patches: ['C:/overlay.yml'],
    })
    expect(args).toEqual([
      'mobile',
      '--from-default-profile',
      'web',
      '--patch',
      'C:/overlay.yml',
      '--no-open',
      '--host',
      '127.0.0.1',
      '--port',
      '5173',
      '--public-url',
      'https://192.168.1.50:8443/',
      '--verbose',
    ])
    expect(buildDshArgs({ profile: 'p', port: 1, publicUrl: 'u', extraArgs: [], profileExists: true })).toHaveLength(8)
  })

  it('en Windows usa cmd.exe solo para .cmd/.bat', () => {
    const direct = toSpawnCommand('C:/tools/dsh.exe', ['a b'])
    expect(direct.file).toBe('C:/tools/dsh.exe')
    if (process.platform === 'win32') {
      const wrapped = toSpawnCommand('C:/tools/dsh.cmd', ['--port', '5173'])
      expect(wrapped.file.toLowerCase()).toContain('cmd')
      expect(wrapped.windowsVerbatimArguments).toBe(true)
      expect(wrapped.args[3]).toContain('--port')
    }
  })
})

describe('overlay de sesiones y modelo', () => {
  it('genera el patch que aísla el log de sesiones', () => {
    const patch = buildSessionsPatch()
    expect(patch).toContain('session-persistence-jsonl')
    expect(patch).toContain("sessions-mobile")
  })

  it('extrae la fila agent-default-model del perfil de escritorio', () => {
    const text = ['- id: another', '  config:', '    x: 1', '- id: agent-default-model', '  config:', '    model: deepseek-account', '- id: other'].join('\n')
    expect(extractAgentDefaultModel(text)).toBe('- id: agent-default-model\n  config:\n    model: deepseek-account')
    expect(extractAgentDefaultModel('- id: otro')).toBeNull()
  })

  it('escribe el overlay con sesiones aisladas y modelo', async () => {
    await withDir(async (dir) => {
      const dshHome = join(dir, 'home')
      await mkdir(join(dshHome, 'profiles', 'desktop'), { recursive: true })
      await writeFile(
        join(dshHome, 'profiles', 'desktop', 'cordis.patch.yml'),
        '- id: agent-default-model\n  config:\n    model: deepseek-account\n',
        'utf8',
      )
      const file = await ensureOverlayPatch({ dataDir: dir, dshHome, sessions: 'isolated' })
      expect(file).toBe(join(dir, 'mobile-overlay.patch.yml'))
      const content = await readFile(file!, 'utf8')
      expect(content).toContain('sessions-mobile')
      expect(content).toContain('deepseek-account')
    })
  })

  it('en modo shared solo copia el modelo y puede no escribir nada', async () => {
    await withDir(async (dir) => {
      const dshHome = join(dir, 'home')
      await mkdir(join(dshHome, 'profiles', 'desktop'), { recursive: true })
      await writeFile(join(dshHome, 'profiles', 'desktop', 'cordis.patch.yml'), '- id: agent-default-model\n  config:\n    model: x\n', 'utf8')
      const shared = await ensureOverlayPatch({ dataDir: dir, dshHome, sessions: 'shared' })
      const content = await readFile(shared!, 'utf8')
      expect(content).not.toContain('sessions-mobile')

      await removeTempDir(join(dshHome, 'profiles'))
      const none = await ensureOverlayPatch({ dataDir: dir, dshHome, sessions: 'shared' })
      expect(none).toBeNull()
    })
  })

  it('reserva un puerto loopback libre', async () => {
    const port = await pickFreePort()
    expect(port).toBeGreaterThan(0)
    expect(port).toBeLessThan(65_536)
  })
})
