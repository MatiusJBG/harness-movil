import { afterEach, describe, expect, it } from './helpers/testkit.js'
import { join } from 'node:path'
import { DeviceLimitError, DeviceStore, sanitizeDeviceName } from '../src/devices.js'
import { makeTempDir, removeTempDir } from './helpers/fs.js'

const dirs: string[] = []

async function store(): Promise<{ store: DeviceStore; file: string; dir: string }> {
  const dir = await makeTempDir('devices-')
  dirs.push(dir)
  const file = join(dir, 'devices.json')
  const instance = new DeviceStore(file)
  await instance.load()
  return { store: instance, file, dir }
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(removeTempDir))
})

describe('DeviceStore', () => {
  it('adds, authenticates and revokes devices', async () => {
    const { store: devices } = await store()
    const created = await devices.add({ name: 'Pixel 8', ip: '192.168.1.20', maxDevices: 3 })
    expect(created.device.name).toBe('Pixel 8')
    expect(created.token).toMatch(/^[a-f0-9]{16}\.[A-Za-z0-9_-]{43}$/)
    expect(devices.activeCount()).toBe(1)

    const authenticated = devices.authenticate(created.token, '192.168.1.21')
    expect(authenticated?.id).toBe(created.device.id)
    expect(devices.authenticate('deadbeef.wrong')).toBeNull()
    expect(devices.authenticate(created.token.slice(0, -1))).toBeNull()
    expect(devices.authenticate(null)).toBeNull()

    expect(await devices.revoke(created.device.id)).toBe(true)
    expect(devices.authenticate(created.token)).toBeNull()
    expect(await devices.revoke(created.device.id)).toBe(false)
  })

  it('enforces the device limit', async () => {
    const { store: devices } = await store()
    await devices.add({ name: 'A', ip: null, maxDevices: 1 })
    await expect(devices.add({ name: 'B', ip: null, maxDevices: 1 })).rejects.toBeInstanceOf(DeviceLimitError)
  })

  it('persists records and last seen across reloads', async () => {
    const { store: devices, file } = await store()
    const created = await devices.add({ name: 'iPhone', ip: null, maxDevices: 3 })
    devices.authenticate(created.token)

    const reloaded = new DeviceStore(file)
    await reloaded.load()
    expect(reloaded.list()).toHaveLength(1)
    expect(reloaded.authenticate(created.token)?.name).toBe('iPhone')
  })

  it('loads an empty store when the file is absent or empty', async () => {
    const { store: devices } = await store()
    expect(devices.list()).toEqual([])
  })

  it('revokes every active device', async () => {
    const { store: devices } = await store()
    await devices.add({ name: 'A', ip: null, maxDevices: 5 })
    await devices.add({ name: 'B', ip: null, maxDevices: 5 })
    expect(await devices.revokeAll()).toBe(2)
    expect(devices.activeCount()).toBe(0)
  })
})

describe('sanitizeDeviceName', () => {
  it('strips control characters, trims and caps the length', () => {
    expect(sanitizeDeviceName('  Pixel\u0000 8  ')).toBe('Pixel 8')
    expect(sanitizeDeviceName('')).toBe('Dispositivo')
    expect(sanitizeDeviceName(undefined)).toBe('Dispositivo')
    expect(sanitizeDeviceName('x'.repeat(120)).length).toBe(60)
  })
})
