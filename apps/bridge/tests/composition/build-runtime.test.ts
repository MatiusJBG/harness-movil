import { join } from 'node:path'
import { describe, expect, it } from '../helpers/testkit.js'
import type { AppSettings } from '../../src/application/ports/settings.js'
import { buildRuntime, certificateNames } from '../../src/composition/build-runtime.js'
import { makeTempDir, removeTempDir } from '../helpers/fs.js'

function settingsWith(lanHost: string, publicHost: string | null): AppSettings {
  return {
    network: { lanHost, publicHost } as AppSettings['network'],
  } as AppSettings
}

function fullSettings(dir: string): AppSettings {
  return {
    paths: {
      dataDir: dir,
      configFile: join(dir, 'config.json'),
      tlsDir: join(dir, 'tls'),
      devicesFile: join(dir, 'devices.json'),
      logDir: join(dir, 'logs'),
      dshHome: join(dir, 'home'),
    },
    network: {
      bindHost: '127.0.0.1',
      lanHost: '127.0.0.1',
      publicHost: '127.0.0.1',
      port: 8443,
      adminHost: '127.0.0.1',
      adminPort: 8444,
      authority: '127.0.0.1:8443',
      adminAuthority: '127.0.0.1:8444',
      publicUrl: 'https://127.0.0.1:8443/',
      adminUrl: 'http://127.0.0.1:8444/_hm/',
    },
    harness: { command: 'auto', profile: 'mobile', home: null, sessions: 'isolated', extraArgs: [], startTimeoutMs: 90_000 },
    pairing: { ticketTtlSeconds: 300, maxDevices: 3 },
    activation: { autoStart: false, idleAutoOffMinutes: 0 },
    limits: { pairingPerMinute: 10, maxBodyBytes: 4_096 },
    tls: { mode: 'local-ca', certFile: null, keyFile: null, caFile: null },
  }
}

describe('composición: nombres del certificado', () => {
  it('incluye LAN, host anunciado, equipo y loopback', () => {
    expect(certificateNames(settingsWith('192.168.1.50', 'pc.local'), 'Mi-PC')).toEqual([
      '192.168.1.50',
      'pc.local',
      'Mi-PC',
      'Mi-PC.local',
      'localhost',
      '127.0.0.1',
      '::1',
    ])
  })

  it('deduplica cuando el host público coincide con la IP de LAN', () => {
    const sans = certificateNames(settingsWith('192.168.1.50', '192.168.1.50'), 'Mi-PC')
    expect(sans.filter((value) => value === '192.168.1.50')).toHaveLength(1)
  })
})

describe('composición: runtime de arranque', () => {
  it('construye reloj, logger, TLS local y versión', async () => {
    const dir = await makeTempDir('runtime-')
    try {
      const runtime = await buildRuntime({
        settings: fullSettings(dir),
        env: { HARNESS_MOVIL_LOG_LEVEL: 'debug' },
        publicDir: dir,
        manifestUrl: new URL('../../../package.json', import.meta.url),
      })
      expect(runtime.version).toBe('0.1.0')
      expect(runtime.tls.certPem).toContain('BEGIN CERTIFICATE')
      expect(runtime.tls.caPem).toContain('BEGIN CERTIFICATE')
      expect(runtime.publicDir).toBe(dir)
      expect(runtime.clock.nowMs()).toBeGreaterThan(0)
      await runtime.logger.close()
    } finally {
      await removeTempDir(dir)
    }
  })
})
