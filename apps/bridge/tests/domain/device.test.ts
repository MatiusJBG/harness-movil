import { describe, expect, it } from '../helpers/testkit.js'
import { createDevice, isActiveDevice, markDeviceSeen, revokeDevice, toPublicDevice } from '../../src/domain/device/device.js'

const base = { id: 'abc123', name: '  Teléfono  ', tokenHash: 'hash', ip: '192.168.0.2', timestamp: '2026-01-01T00:00:00.000Z' }

describe('entidad Device', () => {
  it('crea el registro con el nombre saneado y activo', () => {
    const device = createDevice(base)
    expect(device.name).toBe('Teléfono')
    expect(device.createdAt).toBe(base.timestamp)
    expect(device.lastSeenAt).toBe(base.timestamp)
    expect(device.lastIp).toBe('192.168.0.2')
    expect(device.revokedAt).toBeNull()
    expect(isActiveDevice(device)).toBe(true)
  })

  it('rechaza identificador o hash vacíos', () => {
    expect(() => createDevice({ ...base, id: '  ' })).toThrow('identificador del dispositivo')
    expect(() => createDevice({ ...base, tokenHash: '' })).toThrow('hash del token')
  })

  it('revoca una sola vez y conserva la fecha original', () => {
    const device = revokeDevice(createDevice(base), '2026-02-01T00:00:00.000Z')
    expect(device.revokedAt).toBe('2026-02-01T00:00:00.000Z')
    expect(isActiveDevice(device)).toBe(false)
    const again = revokeDevice(device, '2026-03-01T00:00:00.000Z')
    expect(again.revokedAt).toBe('2026-02-01T00:00:00.000Z')
  })

  it('actualiza última actividad sin mutar el original', () => {
    const device = createDevice(base)
    const seen = markDeviceSeen(device, '2026-04-01T00:00:00.000Z', '10.0.0.7')
    expect(seen.lastSeenAt).toBe('2026-04-01T00:00:00.000Z')
    expect(seen.lastIp).toBe('10.0.0.7')
    expect(device.lastSeenAt).toBe(base.timestamp)
    expect(markDeviceSeen(device, '2026-04-01T00:00:00.000Z', null).lastIp).toBe('192.168.0.2')
  })

  it('proyecta sin exponer el hash', () => {
    const publicDevice = toPublicDevice(createDevice(base))
    expect(Object.keys(publicDevice).includes('tokenHash')).toBe(false)
    expect(publicDevice.id).toBe('abc123')
  })
})
