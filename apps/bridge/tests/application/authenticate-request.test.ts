import { describe, expect, it } from '../helpers/testkit.js'
import { authenticateRequest } from '../../src/application/use-cases/authenticate-request.js'
import { createDeviceRecord, createFakeClock, createFakeDevices, createFakeHasher } from '../helpers/fakes.js'

function setup() {
  const clock = createFakeClock()
  const devices = createFakeDevices([createDeviceRecord('device-1', { lastIp: '192.168.0.2' })])
  return { clock, devices, deps: { devices, hasher: createFakeHasher(), clock } }
}

describe('caso de uso: autenticar pedido', () => {
  it('acepta el token correcto y actualiza última actividad', () => {
    const { deps, clock, devices } = setup()
    clock.advance(5_000)
    const device = authenticateRequest(deps, { token: 'device-1.secret-device-1', ip: '10.0.0.4' })
    expect(device?.id).toBe('device-1')
    expect(devices.records[0]!.lastIp).toBe('10.0.0.4')
    expect(devices.records[0]!.lastSeenAt).toBe(new Date(clock.nowMs()).toISOString())
  })

  it('rechaza token malformado, id desconocido y secreto incorrecto', () => {
    const { deps } = setup()
    expect(authenticateRequest(deps, { token: null, ip: null })).toBeNull()
    expect(authenticateRequest(deps, { token: 'sin-punto', ip: null })).toBeNull()
    expect(authenticateRequest(deps, { token: 'otro.secreto', ip: null })).toBeNull()
    expect(authenticateRequest(deps, { token: 'device-1.incorrecto', ip: null })).toBeNull()
  })

  it('rechaza un dispositivo revocado', () => {
    const { devices, deps } = setup()
    devices.records[0] = { ...devices.records[0]!, revokedAt: '2026-01-01T00:00:00.000Z' }
    expect(authenticateRequest(deps, { token: 'device-1.secret-device-1', ip: null })).toBeNull()
  })

  it('conserva la última IP cuando el pedido no la informa', () => {
    const { deps, devices } = setup()
    authenticateRequest(deps, { token: 'device-1.secret-device-1', ip: null })
    expect(devices.records[0]!.lastIp).toBe('192.168.0.2')
  })
})
