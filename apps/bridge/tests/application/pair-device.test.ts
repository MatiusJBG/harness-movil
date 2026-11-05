import { describe, expect, it } from '../helpers/testkit.js'
import { DeviceLimitReachedError, TicketInvalidError } from '../../src/application/errors.js'
import { pairDevice, type PairDeviceDeps } from '../../src/application/use-cases/pair-device.js'
import { createDeviceRecord, createFakeClock, createFakeDevices, createFakeHasher, createFakeIds, createFakeTickets } from '../helpers/fakes.js'

function setup(options: { devices?: ReturnType<typeof createDeviceRecord>[]; maxDevices?: number } = {}) {
  const clock = createFakeClock()
  const tickets = createFakeTickets()
  const devices = createFakeDevices(options.devices ?? [])
  const deps: PairDeviceDeps = {
    tickets,
    devices,
    hasher: createFakeHasher(),
    ids: createFakeIds(),
    clock,
  }
  const issued = tickets.issue(300_000, clock.nowMs())
  return { clock, tickets, devices, deps, issued, maxDevices: options.maxDevices ?? 3 }
}

describe('caso de uso: emparejar dispositivo', () => {
  it('canjea el ticket, registra el dispositivo y devuelve el token una sola vez', async () => {
    const { deps, devices, tickets, issued, maxDevices } = setup()
    const result = await pairDevice(deps, { code: issued.code, name: '  Pixel 8 ', ip: '192.168.0.9', maxDevices })

    expect(result.device.name).toBe('Pixel 8')
    expect(result.device.lastIp).toBe('192.168.0.9')
    expect(result.token).toBe('device-1.secret-1')
    expect(devices.records).toHaveLength(1)
    expect(devices.added[0]!.tokenHash).toBe('sha:secret-1')
    expect(tickets.redeemedCount).toBe(1)
    expect(tickets.ticket).toBeNull()
  })

  it('acepta el secreto del QR además del código', async () => {
    const { deps, issued, maxDevices } = setup()
    const result = await pairDevice(deps, { secret: issued.secret, maxDevices })
    expect(result.device.id).toBe('device-1')
  })

  it('rechaza cuando no hay ticket vigente', async () => {
    const { deps, tickets, maxDevices } = setup()
    tickets.clear()
    await expect(pairDevice(deps, { code: '000042', maxDevices })).rejects.toThrow(TicketInvalidError)
  })

  it('rechaza un ticket vencido sin registrar nada', async () => {
    const { deps, clock, devices, maxDevices } = setup()
    clock.advance(300_001)
    await expect(pairDevice(deps, { code: '000042', maxDevices })).rejects.toThrow(TicketInvalidError)
    expect(devices.records).toHaveLength(0)
  })

  it('rechaza un código incorrecto y no consume el ticket', async () => {
    const { deps, tickets, devices, maxDevices } = setup()
    await expect(pairDevice(deps, { code: '999999', maxDevices })).rejects.toThrow(TicketInvalidError)
    expect(tickets.redeemedCount).toBe(0)
    expect(tickets.ticket).not.toBeNull()
    expect(devices.records).toHaveLength(0)
  })

  it('no consume el ticket cuando se alcanzó el límite de dispositivos', async () => {
    const seeded = [createDeviceRecord('a'), createDeviceRecord('b'), createDeviceRecord('c')]
    const { deps, tickets, maxDevices } = setup({ devices: seeded })
    await expect(pairDevice(deps, { code: '000042', maxDevices })).rejects.toThrow(DeviceLimitReachedError)
    expect(tickets.redeemedCount).toBe(0)
    expect(tickets.ticket).not.toBeNull()
  })

  it('es de un solo uso ante dos pedidos concurrentes', async () => {
    const { deps, tickets, devices, issued, maxDevices } = setup()
    const results = await Promise.allSettled([
      pairDevice(deps, { code: issued.code, maxDevices }),
      pairDevice(deps, { code: issued.code, maxDevices }),
    ])
    const fulfilled = results.filter((entry) => entry.status === 'fulfilled')
    const rejected = results.filter((entry) => entry.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(tickets.redeemedCount).toBe(1)
    expect(devices.records).toHaveLength(1)
  })

  it('propaga el fallo de persistencia (el ticket queda consumido por diseño)', async () => {
    const { deps, devices, tickets, issued, maxDevices } = setup()
    devices.failAdd = true
    await expect(pairDevice(deps, { code: issued.code, maxDevices })).rejects.toThrow('fallo de escritura simulado')
    expect(tickets.redeemedCount).toBe(1)
    expect(devices.records).toHaveLength(0)
  })
})
