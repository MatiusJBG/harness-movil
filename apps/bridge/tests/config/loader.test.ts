import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from '../helpers/testkit.js'
import { describeSettings, loadSettings } from '../../src/config/loader.js'
import { ConfigError } from '../../src/config/errors.js'
import { ConfigSchema, defaultConfig } from '../../src/config/schema.js'
import { createFakeInterfaces } from '../helpers/fakes.js'
import { makeTempDir, removeTempDir } from '../helpers/fs.js'

async function withDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await makeTempDir('config-')
  try {
    return await run(dir)
  } finally {
    await removeTempDir(dir)
  }
}

const env = { HARNESS_MOVIL_DATA_DIR: undefined, DSH_HOME: undefined }
const interfaces = createFakeInterfaces()
const explicitHost = { server: { lan: { host: '127.0.0.1' } } }

describe('configuración v2', () => {
  it('crea un config v2 por defecto cuando no existe', async () => {
    await withDir(async (dir) => {
      const loaded = await loadSettings({ dataDir: dir, env: {}, interfaces })
      expect(loaded.migrated).toBe(true)
      expect(loaded.config.schemaVersion).toBe(2)
      expect(loaded.settings.network.lanHost).toBe('192.168.1.50')
      const written = JSON.parse(await readFile(join(dir, 'config.json'), 'utf8')) as { schemaVersion: number }
      expect(written.schemaVersion).toBe(2)
      expect(loaded.backupFile).toBeNull()
    })
  })

  it('migra v1 a v2, respalda el original y es idempotente', async () => {
    await withDir(async (dir) => {
      const legacy = {
        listen: { host: '127.0.0.1', port: 9443, adminPort: 9444 },
        dsh: { profile: 'mobile-x', sessions: 'shared', extraArgs: ['--verbose'] },
        pairing: { codeTtlSeconds: 120, maxDevices: 2 },
        activation: { autoStart: true, idleAutoOffMinutes: 5 },
        limits: { pairingPerMinute: 3 },
        publicHost: 'pc.local',
      }
      const original = `${JSON.stringify(legacy, null, 2)}\n`
      await writeFile(join(dir, 'config.json'), original, 'utf8')

      const loaded = await loadSettings({ dataDir: dir, env: {}, interfaces })
      expect(loaded.migrated).toBe(true)
      expect(loaded.settings.network.port).toBe(9443)
      expect(loaded.settings.network.adminPort).toBe(9444)
      expect(loaded.settings.network.adminAuthority).toBe('127.0.0.1:9444')
      expect(loaded.settings.network.publicUrl).toBe('https://pc.local:9443/')
      expect(loaded.settings.harness.profile).toBe('mobile-x')
      expect(loaded.settings.harness.sessions).toBe('shared')
      expect([...loaded.settings.harness.extraArgs]).toEqual(['--verbose'])
      expect(loaded.settings.pairing.ticketTtlSeconds).toBe(120)
      expect(loaded.settings.pairing.maxDevices).toBe(2)
      expect(loaded.settings.activation.autoStart).toBe(true)
      expect(loaded.settings.limits.pairingPerMinute).toBe(3)
      expect(loaded.backupFile).toBe(join(dir, 'config.v1.json'))
      expect(await readFile(loaded.backupFile!, 'utf8')).toBe(original)

      const second = await loadSettings({ dataDir: dir, env: {}, interfaces })
      expect(second.migrated).toBe(false)
      expect(second.settings.pairing.ticketTtlSeconds).toBe(120)
    })
  })

  it('no escribe nada en modo lectura', async () => {
    await withDir(async (dir) => {
      await writeFile(join(dir, 'config.json'), JSON.stringify({ listen: { host: '127.0.0.1' } }), 'utf8')
      const before = await readFile(join(dir, 'config.json'), 'utf8')
      const loaded = await loadSettings({ dataDir: dir, env: {}, interfaces, readOnly: true })
      expect(loaded.migrated).toBe(true)
      expect(await readFile(join(dir, 'config.json'), 'utf8')).toBe(before)
      expect(existsSync(join(dir, 'config.v1.json'))).toBe(false)
    })
  })

  it('rechaza claves mezcladas, versiones desconocidas y claves inválidas', async () => {
    await withDir(async (dir) => {
      await writeFile(join(dir, 'config.json'), JSON.stringify({ schemaVersion: 2, listen: {} }), 'utf8')
      await expect(loadSettings({ dataDir: dir, env: {}, interfaces })).rejects.toThrow(ConfigError)

      await writeFile(join(dir, 'config.json'), JSON.stringify({ schemaVersion: 3 }), 'utf8')
      try {
        await loadSettings({ dataDir: dir, env: {}, interfaces })
        throw new Error('debía fallar')
      } catch (error) {
        expect((error as ConfigError).code).toBe('config-unsupported-version')
      }

      await writeFile(join(dir, 'config.json'), JSON.stringify({ desconocida: true }), 'utf8')
      try {
        await loadSettings({ dataDir: dir, env: {}, interfaces })
        throw new Error('debía fallar')
      } catch (error) {
        expect((error as ConfigError).code).toBe('config-unknown-keys')
      }

      await writeFile(join(dir, 'config.json'), JSON.stringify({ schemaVersion: 2, server: { lan: { port: 'abc' } } }), 'utf8')
      await expect(loadSettings({ dataDir: dir, env: {}, interfaces })).rejects.toThrow('config.json inválido')
    })
  })

  it('exige archivos cuando tls.mode es "files"', async () => {
    await withDir(async (dir) => {
      await writeFile(
        join(dir, 'config.json'),
        JSON.stringify({ schemaVersion: 2, ...explicitHost, tls: { mode: 'files' } }),
        'utf8',
      )
      await expect(loadSettings({ dataDir: dir, env: {}, interfaces })).rejects.toThrow('tls.certFile')
    })
  })

  it('respeta DSH_HOME y harness.home', async () => {
    await withDir(async (dir) => {
      const loaded = await loadSettings({ dataDir: dir, env: { DSH_HOME: 'C:/dsh-env' }, interfaces })
      expect(loaded.settings.paths.dshHome).toBe('C:/dsh-env')

      await writeFile(
        join(dir, 'config.json'),
        JSON.stringify({ schemaVersion: 2, ...explicitHost, harness: { home: 'C:/dsh-config' } }),
        'utf8',
      )
      const configured = await loadSettings({ dataDir: dir, env: { DSH_HOME: 'C:/dsh-env' }, interfaces })
      expect(configured.settings.paths.dshHome).toBe('C:/dsh-config')
    })
  })

  it('describe la configuración sin secretos para --check-config', async () => {
    await withDir(async (dir) => {
      const loaded = await loadSettings({ dataDir: dir, env: {}, interfaces })
      const view = describeSettings(loaded)
      expect(view.schemaVersion).toBe(2)
      expect(JSON.stringify(view)).not.toContain('secret')
    })
  })

  it('rechaza un admin host fuera de loopback con ConfigError accionable', async () => {
    await withDir(async (dir) => {
      await writeFile(join(dir, 'config.json'), JSON.stringify({ schemaVersion: 2, server: { admin: { host: '0.0.0.0' } } }), 'utf8')
      try {
        await loadSettings({ dataDir: dir, env: {}, interfaces })
        throw new Error('debía fallar')
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigError)
        expect((error as ConfigError).code).toBe('config-invalid')
        expect(String((error as Error).message)).toContain('server.admin.host')
      }
    })
  })

  it('falla con claves desconocidas anidadas al migrar v1', async () => {
    const cases = [
      { legacy: { listen: { host: '127.0.0.1', adminHost: '0.0.0.0' } }, path: 'listen.adminHost' },
      { legacy: { dsh: { profile: 'mobile', foo: true } }, path: 'dsh.foo' },
      { legacy: { pairing: { maxDevices: 2, extra: 1 } }, path: 'pairing.extra' },
    ]
    for (const entry of cases) {
      await withDir(async (dir) => {
        await writeFile(join(dir, 'config.json'), JSON.stringify(entry.legacy), 'utf8')
        try {
          await loadSettings({ dataDir: dir, env: {}, interfaces })
          throw new Error('debía fallar')
        } catch (error) {
          expect(error).toBeInstanceOf(ConfigError)
          expect((error as ConfigError).code).toBe('config-unknown-keys')
          expect(String((error as Error).message)).toContain(entry.path)
        }
        expect(existsSync(join(dir, 'config.v1.json'))).toBe(false)
      })
    }
  })

  it('--check-config no crea el directorio de datos', async () => {
    await withDir(async (dir) => {
      const target = join(dir, 'no-crear')
      const loaded = await loadSettings({ dataDir: target, env: {}, interfaces, readOnly: true })
      expect(loaded.migrated).toBe(true)
      expect(existsSync(target)).toBe(false)
    })
  })

  it('el esquema por defecto es válido y estricto', () => {
    expect(defaultConfig().schemaVersion).toBe(2)
    expect(ConfigSchema.safeParse({ schemaVersion: 2, extra: true }).success).toBe(false)
    expect(env.HARNESS_MOVIL_DATA_DIR).toBeUndefined()
  })
})
