import { afterEach, describe, expect, it } from './helpers/testkit.js'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ConfigError, defaultDataDir, loadConfig, pickLanAddress } from '../src/config.js'
import { makeTempDir, removeTempDir } from './helpers/fs.js'

const dirs: string[] = []

async function tempDir(): Promise<string> {
  const dir = await makeTempDir('config-')
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(removeTempDir))
})

describe('pickLanAddress', () => {
  it('prefers Wi-Fi over virtual adapters and skips loopback/link-local', () => {
    const ip = pickLanAddress({
      'vEthernet (WSL)': [
        { address: '172.20.0.1', netmask: '255.255.240.0', family: 'IPv4', mac: '00', internal: false, cidr: null },
      ],
      'Wi-Fi': [
        { address: '192.168.1.44', netmask: '255.255.255.0', family: 'IPv4', mac: '00', internal: false, cidr: null },
        { address: 'fe80::1', netmask: 'ffff::', family: 'IPv6', mac: '00', internal: false, cidr: null, scopeid: 0 },
      ],
      Loopback: [
        { address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', mac: '00', internal: true, cidr: null },
      ],
    })
    expect(ip).toBe('192.168.1.44')
  })

  it('honours a preferred address when present', () => {
    const interfaces = {
      Ethernet: [
        { address: '10.0.0.5', netmask: '255.255.255.0', family: 'IPv4' as const, mac: '00', internal: false, cidr: null },
        { address: '10.0.0.6', netmask: '255.255.255.0', family: 'IPv4' as const, mac: '00', internal: false, cidr: null },
      ],
    }
    expect(pickLanAddress(interfaces, '10.0.0.6')).toBe('10.0.0.6')
  })

  it('returns null when only loopback is available', () => {
    expect(
      pickLanAddress({
        Loopback: [
          { address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', mac: '00', internal: true, cidr: null },
        ],
      }),
    ).toBeNull()
  })
})

describe('loadConfig', () => {
  it('writes defaults and resolves the admin port', async () => {
    const dataDir = await tempDir()
    await writeFile(
      join(dataDir, 'config.json'),
      JSON.stringify({ listen: { host: '127.0.0.1', port: 18443 }, dsh: { home: join(dataDir, 'home') } }),
    )
    const config = await loadConfig({ dataDir, env: {} })
    expect(config.config.listen.host).toBe('127.0.0.1')
    expect(config.port).toBe(18443)
    expect(config.adminPort).toBe(18444)
    expect(config.authority).toBe('127.0.0.1:18443')
    expect(config.publicUrl).toBe('https://127.0.0.1:18443/')
    expect(config.adminUrl).toBe('http://127.0.0.1:18444/_hm/')
    expect(config.dshHome).toBe(join(dataDir, 'home'))
    expect(config.config.dsh.profile).toBe('mobile')
    expect(config.config.activation.idleAutoOffMinutes).toBe(30)
  })

  it('creates config.json when missing', async () => {
    const dataDir = await tempDir()
    await loadConfig({ dataDir, env: { HARNESS_MOVIL_PREFERRED_IP: '192.168.1.50' } })
    const config = await loadConfig({ dataDir, env: { HARNESS_MOVIL_PREFERRED_IP: '192.168.1.50' } })
    expect(config.config.listen.port).toBe(8443)
  })

  it('rejects malformed JSON', async () => {
    const dataDir = await tempDir()
    await writeFile(join(dataDir, 'config.json'), '{ nope')
    await expect(loadConfig({ dataDir, env: {} })).rejects.toBeInstanceOf(ConfigError)
  })

  it('rejects invalid field values', async () => {
    const dataDir = await tempDir()
    await writeFile(join(dataDir, 'config.json'), JSON.stringify({ listen: { port: 0 } }))
    await expect(loadConfig({ dataDir, env: {} })).rejects.toBeInstanceOf(ConfigError)
  })

  it('rejects unknown fields and files mode without paths', async () => {
    const dataDir = await tempDir()
    await writeFile(join(dataDir, 'config.json'), JSON.stringify({ listen: { port: 9000 }, extra: true }))
    await expect(loadConfig({ dataDir, env: {} })).rejects.toBeInstanceOf(ConfigError)

    const second = await tempDir()
    await writeFile(join(second, 'config.json'), JSON.stringify({ tls: { mode: 'files' } }))
    await expect(loadConfig({ dataDir: second, env: {} })).rejects.toBeInstanceOf(ConfigError)
  })

  it('rejects a non-literal listen host', async () => {
    const dataDir = await tempDir()
    await writeFile(join(dataDir, 'config.json'), JSON.stringify({ listen: { host: 'harness.local' } }))
    await expect(loadConfig({ dataDir, env: {} })).rejects.toBeInstanceOf(ConfigError)
  })

  it('uses an explicit publicHost for the advertised authority', async () => {
    const dataDir = await tempDir()
    await writeFile(
      join(dataDir, 'config.json'),
      JSON.stringify({ listen: { host: '127.0.0.1', port: 19000 }, publicHost: 'harness-pc' }),
    )
    const config = await loadConfig({ dataDir, env: {} })
    expect(config.authority).toBe('harness-pc:19000')
    expect(config.publicUrl).toBe('https://harness-pc:19000/')
  })
})

describe('defaultDataDir', () => {
  it('prefers the env override, then LOCALAPPDATA', () => {
    expect(defaultDataDir({ HARNESS_MOVIL_DATA_DIR: 'C:\\data' } as NodeJS.ProcessEnv)).toBe('C:\\data')
    expect(defaultDataDir({ LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' } as NodeJS.ProcessEnv)).toContain(
      'harness-movil',
    )
  })
})
