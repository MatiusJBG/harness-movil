import { describe, expect, it } from '../helpers/testkit.js'
import { DeviceNotFoundError, NotAuthorizedError } from '../../src/application/errors.js'
import { revokeDevice } from '../../src/application/use-cases/revoke-device.js'
import { listDevices } from '../../src/application/use-cases/list-devices.js'
import { signOutDevice } from '../../src/application/use-cases/sign-out-device.js'
import { createDeviceRecord, createFakeClock, createFakeDevices } from '../helpers/fakes.js'

function setup() {
  const clock = createFakeClock()
  const devices = createFakeDevices([createDeviceRecord('device-1'), createDeviceRecord('device-2')])
  return { clock, devices, deps: { devices, clock } }
}

describe('caso de uso: revocar dispositivo', () => {
  it('el panel admin revoca cualquier dispositivo', async () => {
    const { deps, devices } = setup()
    await revokeDevice(deps, { id: 'device-2', requester: { admin: true, deviceId: null } })
    expect(devices.records[1]!.revokedAt).not.toBeNull()
  })

  it('un teléfono solo puede revocarse a sí mismo', async () => {
    const { deps, devices } = setup()
    await revokeDevice(deps, { id: 'device-1', requester: { admin: false, deviceId: 'device-1' } })
    expect(devices.records[0]!.revokedAt).not.toBeNull()
    await expect(
      revokeDevice(deps, { id: 'device-2', requester: { admin: false, deviceId: 'device-1' } }),
    ).rejects.toThrow(NotAuthorizedError)
    expect(devices.records[1]!.revokedAt).toBeNull()
  })

  it('falla con dispositivo inexistente o ya revocado', async () => {
    const { deps } = setup()
    await expect(revokeDevice(deps, { id: 'no-existe', requester: { admin: true, deviceId: null } })).rejects.toThrow(
      DeviceNotFoundError,
    )
    await revokeDevice(deps, { id: 'device-1', requester: { admin: true, deviceId: null } })
    await expect(revokeDevice(deps, { id: 'device-1', requester: { admin: true, deviceId: null } })).rejects.toThrow(
      DeviceNotFoundError,
    )
  })
})

describe('caso de uso: cerrar sesión', () => {
  it('revoca el dispositivo actual y tolera que no haya sesión', async () => {
    const { deps, devices } = setup()
    await signOutDevice(deps, { device: { id: 'device-1', name: 'x', createdAt: '', lastSeenAt: '', lastIp: null, revokedAt: null } })
    expect(devices.records[0]!.revokedAt).not.toBeNull()
    await signOutDevice(deps, { device: null })
    expect(devices.records[1]!.revokedAt).toBeNull()
  })
})

describe('caso de uso: listar dispositivos', () => {
  it('el admin ve todos y el teléfono solo el propio', () => {
    const devices = [createDeviceRecord('device-1'), createDeviceRecord('device-2')]
    expect(listDevices({ devices, admin: true, deviceId: 'device-1' }).devices).toHaveLength(2)
    const own = listDevices({ devices, admin: false, deviceId: 'device-1' })
    expect(own.devices).toHaveLength(1)
    expect(own.devices[0]!.id).toBe('device-1')
    expect(own.admin).toBe(false)
  })

  it('oculta los dispositivos revocados', () => {
    const devices = [
      createDeviceRecord('device-1'),
      createDeviceRecord('device-2', { revokedAt: '2026-01-01T00:00:00.000Z' }),
    ]
    expect(listDevices({ devices, admin: true, deviceId: null }).devices).toHaveLength(1)
    expect(listDevices({ devices, admin: true, deviceId: null }).devices[0]!.id).toBe('device-1')
  })

  it('nunca proyecta el hash del token', () => {
    const [view] = listDevices({ devices: [createDeviceRecord('device-1')], admin: true, deviceId: null }).devices
    expect(Object.keys(view!).includes('tokenHash')).toBe(false)
  })
})
