import { describe, expect, it } from '../helpers/testkit.js'
import { readSession } from '../../src/application/use-cases/read-session.js'
import { readStatus } from '../../src/application/use-cases/read-status.js'
import { readDiagnostics } from '../../src/application/use-cases/read-diagnostics.js'
import { readPairingTicket, refreshPairingTicket } from '../../src/application/use-cases/issue-pairing-ticket.js'
import { createActivationReader, createDeviceRecord, createFakeClock, createFakeDevices, createFakeTickets, FIXED_NOW_MS } from '../helpers/fakes.js'

const network = {
  bindHost: '192.168.0.5',
  lanHost: '192.168.0.5',
  publicHost: '192.168.0.5',
  port: 8443,
  adminHost: '127.0.0.1',
  adminPort: 8444,
  authority: '192.168.0.5:8443',
  adminAuthority: '127.0.0.1:8444',
  publicUrl: 'https://192.168.0.5:8443/',
  adminUrl: 'http://127.0.0.1:8444/_hm/',
}

const paths = {
  dataDir: 'C:/data',
  configFile: 'C:/data/config.json',
  tlsDir: 'C:/data/tls',
  devicesFile: 'C:/data/devices.json',
  logDir: 'C:/data/logs',
  dshHome: 'C:/dsh',
}

const harness = {
  command: 'auto',
  profile: 'mobile',
  home: null,
  sessions: 'isolated' as const,
  extraArgs: [],
  startTimeoutMs: 90_000,
}

const certificate = { notAfter: new Date(FIXED_NOW_MS + 86_400_000), fingerprint: 'abc', sans: ['192.168.0.5'] }

describe('caso de uso: vistas de sesión y estado', () => {
  it('describe la sesión emparejada y la activación', () => {
    const view = readSession({ admin: false, device: createDeviceRecord('device-1'), activation: createActivationReader('active') })
    expect(view.paired).toBe(true)
    expect(view.device?.id).toBe('device-1')
    expect(view.activation.state).toBe('active')
    expect(view.activation.port).toBe(5173)
  })

  it('el panel admin siempre figura emparejado aunque no haya cookie', () => {
    const view = readSession({ admin: true, device: null, activation: createActivationReader('inactive') })
    expect(view.paired).toBe(true)
    expect(view.device).toBeNull()
  })

  it('proyecta el estado completo sin secretos', () => {
    const devices = createFakeDevices([createDeviceRecord('device-1')])
    const status = readStatus({
      activation: createActivationReader('active'),
      devices,
      network,
      harness,
      paths,
      sessionsRoot: 'C:/dsh/sessions-mobile',
      certificate,
      version: '0.1.0',
      now: new Date(FIXED_NOW_MS),
    })
    expect(status.active).toBe(true)
    expect(status.pairedDevices).toBe(1)
    expect(status.sessions).toEqual({ mode: 'isolated', root: 'C:/dsh/sessions-mobile' })
    expect(JSON.stringify(status).includes('sha:')).toBe(false)
  })

  it('el diagnóstico expone rutas y certificado', () => {
    const diagnostics = readDiagnostics({
      version: '0.1.0',
      runtime: { node: 'v22.12.0', platform: 'win32-x64' },
      paths,
      harness,
      network,
      certificate,
    })
    expect(diagnostics.dataDir).toBe('C:/data')
    expect(diagnostics.bind).toBe('192.168.0.5:8443')
    expect(diagnostics.admin).toBe('127.0.0.1:8444')
    expect(diagnostics.sessions).toBe('isolated')
  })
})

describe('caso de uso: ticket de emparejamiento', () => {
  it('devuelve el vigente o emite uno nuevo al vencer', () => {
    const clock = createFakeClock()
    const tickets = createFakeTickets()
    const deps = { tickets, clock, ttlSeconds: 300 }
    const first = readPairingTicket(deps)
    expect(readPairingTicket(deps)).toBe(first)
    clock.advance(300_001)
    const second = readPairingTicket(deps)
    expect(second).not.toBe(first)
    expect(tickets.issued).toHaveLength(2)
  })

  it('refresh siempre emite un ticket nuevo', () => {
    const clock = createFakeClock()
    const tickets = createFakeTickets()
    const deps = { tickets, clock, ttlSeconds: 300 }
    const first = refreshPairingTicket(deps)
    const second = refreshPairingTicket(deps)
    expect(second).not.toBe(first)
    expect(tickets.issued).toHaveLength(2)
    expect(second.code).toBe('000042')
    expect(second.expiresAt - second.issuedAt).toBe(300_000)
  })
})
