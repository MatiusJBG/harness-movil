import { afterEach, describe, expect, it, vi } from '../helpers/testkit.js'
import { createDevice } from '../../src/domain/device/device.js'
import { deviceCookie, mutationHeaders, startBridge, type TestBridge } from '../helpers/bridge-harness.js'

const bridges: TestBridge[] = []

afterEach(async () => {
  await Promise.all(bridges.splice(0).map((bridge) => bridge.close()))
})

async function setup(options: Parameters<typeof startBridge>[0] = {}): Promise<TestBridge> {
  const bridge = await startBridge(options)
  bridges.push(bridge)
  return bridge
}

describe('HTTP: sesión, accesos y emparejamiento', () => {
  it('redirige páginas no emparejadas y rechaza la API con 401', async () => {
    const bridge = await setup()
    const page = await bridge.call('lan', '/')
    expect(page.status).toBe(302)
    expect(page.headers.get('location')).toBe('/_hm/')

    const api = await bridge.call('lan', '/api/echo')
    expect(api.status).toBe(401)
    expect((api.json.error as { code: string }).code).toBe('unpaired')
  })

  it('sirve el panel con CSP y estado de sesión sin cookie', async () => {
    const bridge = await setup()
    const page = await bridge.call('lan', '/_hm/')
    expect(page.status).toBe(200)
    expect(page.text).toContain('Harness Móvil')
    expect(page.headers.get('content-security-policy')).toContain("default-src 'self'")

    const session = await bridge.call('lan', '/_hm/api/v1/session')
    expect(session.status).toBe(200)
    expect(session.json.paired).toBe(false)
    expect(session.json.admin).toBe(false)
    expect((session.json.activation as { state: string }).state).toBe('inactive')
  })

  it('el panel admin se considera emparejado sin cookie', async () => {
    const bridge = await setup()
    const session = await bridge.call('admin', '/_hm/api/v1/session')
    expect(session.json.paired).toBe(true)
    expect(session.json.admin).toBe(true)
  })

  it('niega el proxy a un dispositivo emparejado si la conexión está inactiva', async () => {
    const bridge = await setup()
    const api = await bridge.call('lan', '/api/echo', { cookie: deviceCookie() })
    expect(api.status).toBe(503)
    expect((api.json.error as { code: string }).code).toBe('harness-inactive')

    const page = await bridge.call('lan', '/', { cookie: deviceCookie() })
    expect(page.headers.get('location')).toBe('/_hm/?inactive=1')
  })

  it('emite el ticket solo desde la PC y lo canjea con CSRF', async () => {
    const bridge = await setup()
    const phoneTicket = await bridge.call('lan', '/_hm/api/v1/pairing/ticket', { cookie: deviceCookie() })
    expect(phoneTicket.status).toBe(403)
    expect((phoneTicket.json.error as { code: string }).code).toBe('admin-only')

    const ticket = await bridge.call('admin', '/_hm/api/v1/pairing/ticket')
    expect(ticket.status).toBe(200)
    expect(String(ticket.json.code)).toMatch(/^\d{6}$/)
    expect(String(ticket.json.qrDataUrl)).toMatch(/^data:image\/png;base64,/)
    expect(String(ticket.json.url)).toContain('/_hm/#p=')

    const paired = await bridge.call('lan', '/_hm/api/v1/session/pairing', {
      method: 'POST',
      headers: mutationHeaders(bridge.lanPort),
      body: { code: ticket.json.code, name: 'Nuevo teléfono' },
    })
    expect(paired.status).toBe(200)
    expect(paired.cookie).toContain('hm_device=')
    const token = paired.cookie!.split(';', 1)[0]!

    const session = await bridge.call('lan', '/_hm/api/v1/session', { cookie: token })
    expect(session.json.paired).toBe(true)
    expect((session.json.device as { name: string }).name).toBe('Nuevo teléfono')

    const devices = await bridge.call('lan', '/_hm/api/v1/devices', { cookie: token })
    expect(devices.json.admin).toBe(false)
    expect(devices.json.devices).toHaveLength(1)
  })

  it('rechaza código inválido, ticket vencido y cuerpo/CSRF inválidos', async () => {
    const bridge = await setup()
    const invalid = await bridge.call('lan', '/_hm/api/v1/session/pairing', {
      method: 'POST',
      headers: mutationHeaders(bridge.lanPort),
      body: { code: '999999' },
    })
    expect(invalid.status).toBe(401)
    expect((invalid.json.error as { code: string }).code).toBe('ticket-invalid')

    const noCsrf = await bridge.call('lan', '/_hm/api/v1/session/pairing', {
      method: 'POST',
      headers: { origin: `http://127.0.0.1:${String(bridge.lanPort)}` },
      body: { code: bridge.ticket().code },
    })
    expect(noCsrf.status).toBe(403)
    expect((noCsrf.json.error as { code: string }).code).toBe('csrf')

    const huge = await bridge.call('lan', '/_hm/api/v1/session/pairing', {
      method: 'POST',
      headers: mutationHeaders(bridge.lanPort),
      body: { code: bridge.ticket().code, name: 'x'.repeat(8_000) },
    })
    expect(huge.status).toBe(413)

    const expiringCode = bridge.ticket().code
    bridge.clock.advance(300_001)
    const expired = await bridge.call('lan', '/_hm/api/v1/session/pairing', {
      method: 'POST',
      headers: mutationHeaders(bridge.lanPort),
      body: { code: expiringCode },
    })
    expect(expired.status).toBe(401)
  })

  it('limita los intentos de emparejamiento por IP', async () => {
    const bridge = await setup({ pairingPerMinute: 2 })
    const attempt = () =>
      bridge.call('lan', '/_hm/api/v1/session/pairing', {
        method: 'POST',
        headers: mutationHeaders(bridge.lanPort),
        body: { code: '000000' },
      })
    expect((await attempt()).status).toBe(401)
    expect((await attempt()).status).toBe(401)
    const limited = await attempt()
    expect(limited.status).toBe(429)
    expect((limited.json.error as { code: string }).code).toBe('rate-limited')
  })

  it('respeta el máximo de dispositivos activos', async () => {
    const bridge = await setup({ maxDevices: 1 })
    const response = await bridge.call('lan', '/_hm/api/v1/session/pairing', {
      method: 'POST',
      headers: mutationHeaders(bridge.lanPort),
      body: { code: bridge.ticket().code },
    })
    expect(response.status).toBe(409)
    expect((response.json.error as { code: string }).code).toBe('device-limit-reached')
  })

  it('revoca el propio dispositivo, limpia la cookie y deja de autenticarlo', async () => {
    const bridge = await setup()
    const revoked = await bridge.call('lan', '/_hm/api/v1/devices/device-1', {
      method: 'DELETE',
      cookie: deviceCookie(),
      headers: mutationHeaders(bridge.lanPort),
    })
    expect(revoked.status).toBe(200)
    expect(revoked.cookie).toContain('Max-Age=0')

    const after = await bridge.call('lan', '/_hm/api/v1/session', { cookie: deviceCookie() })
    expect(after.json.paired).toBe(false)
  })

  it('un teléfono no puede revocar otro dispositivo y el admin sí', async () => {
    const bridge = await setup()
    await bridge.devices.add(
      createDevice({
        id: 'device-2',
        name: 'Otro',
        tokenHash: 'sha:secret-2',
        ip: null,
        timestamp: new Date(bridge.clock.nowMs()).toISOString(),
      }),
    )
    const denied = await bridge.call('lan', '/_hm/api/v1/devices/device-2', {
      method: 'DELETE',
      cookie: deviceCookie(),
      headers: mutationHeaders(bridge.lanPort),
    })
    expect(denied.status).toBe(403)
    expect((denied.json.error as { code: string }).code).toBe('not-authorized')

    const allowed = await bridge.call('admin', '/_hm/api/v1/devices/device-2', {
      method: 'DELETE',
      headers: mutationHeaders(bridge.adminPort),
    })
    expect(allowed.status).toBe(200)
  })

  it('cierra sesión revocando el dispositivo actual', async () => {
    const bridge = await setup()
    const response = await bridge.call('lan', '/_hm/api/v1/session', {
      method: 'DELETE',
      cookie: deviceCookie(),
      headers: mutationHeaders(bridge.lanPort),
    })
    expect(response.status).toBe(200)
    expect(response.json.ok).toBe(true)
    expect(bridge.devices.find('device-1')?.revokedAt).not.toBeNull()
  })

  it('expone rutas inexistentes del panel como 404 uniforme', async () => {
    const bridge = await setup()
    const response = await bridge.call('lan', '/_hm/no-existe')
    expect(response.status).toBe(404)
    expect((response.json.error as { code: string }).code).toBe('not-found')
  })
})

describe('HTTP: activación', () => {
  it('activa, proyecta estado y desactiva', async () => {
    const bridge = await setup()
    const activated = await bridge.call('lan', '/_hm/api/v1/activation', {
      method: 'POST',
      cookie: deviceCookie(),
      headers: mutationHeaders(bridge.lanPort),
    })
    expect(activated.status).toBe(202)

    await vi.waitFor(() => {
      expect(bridge.activation.state()).toBe('active')
    })

    const status = await bridge.call('lan', '/_hm/api/v1/status', { cookie: deviceCookie() })
    expect(status.status).toBe(200)
    expect(status.json.active).toBe(true)
    expect(status.json.pairedDevices).toBe(1)
    expect((status.json.sessions as { mode: string }).mode).toBe('isolated')
    expect(String((status.json.sessions as { root: string }).root)).toContain('sessions-mobile')

    const deactivated = await bridge.call('lan', '/_hm/api/v1/activation', {
      method: 'DELETE',
      cookie: deviceCookie(),
      headers: mutationHeaders(bridge.lanPort),
    })
    expect(deactivated.status).toBe(200)
    expect((deactivated.json as { state: string }).state).toBe('inactive')
  })

  it('protege las mutaciones con same-origin y CSRF', async () => {
    const bridge = await setup()
    const noOrigin = await bridge.call('lan', '/_hm/api/v1/activation', { method: 'POST', cookie: deviceCookie() })
    expect(noOrigin.status).toBe(403)
  })
})
