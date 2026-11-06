import { request } from 'node:http'
import { afterEach, describe, expect, it, vi } from '../helpers/testkit.js'
import { deviceCookie, startBridge, type TestBridge } from '../helpers/bridge-harness.js'
import { adminHostsAllowed } from '../../src/adapters/http/server/admin-guard.js'

const bridges: TestBridge[] = []

afterEach(async () => {
  await Promise.all(bridges.splice(0).map((bridge) => bridge.close()))
})

async function setup(options: Parameters<typeof startBridge>[0] = {}): Promise<TestBridge> {
  const bridge = await startBridge(options)
  bridges.push(bridge)
  return bridge
}

async function activate(bridge: TestBridge): Promise<void> {
  await bridge.activation.activate()
  await vi.waitFor(() => {
    expect(bridge.activation.state()).toBe('active')
  })
}

function adminStatus(port: number, path: string, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET', headers: { host } }, (res) => {
      res.resume()
      resolve(res.statusCode ?? 0)
    })
    req.on('error', reject)
    req.end()
  })
}

describe('endurecimiento del panel admin', () => {
  it('rechaza un Host spoofeado y acepta los literales loopback', async () => {
    const bridge = await setup()
    expect(await adminStatus(bridge.adminPort, '/_hm/api/v1/session', 'evil.example')).toBe(403)
    expect(await adminStatus(bridge.adminPort, '/_hm/api/v1/session', `127.0.0.1:${String(bridge.adminPort)}`)).toBe(200)
    expect(await adminStatus(bridge.adminPort, '/_hm/api/v1/session', `localhost:${String(bridge.adminPort)}`)).toBe(200)
  })

  it('valida el allowlist de Host y el origen loopback', () => {
    expect(adminHostsAllowed('127.0.0.1:8444', 8444)).toBe(true)
    expect(adminHostsAllowed('LOCALHOST:8444', 8444)).toBe(true)
    expect(adminHostsAllowed('[::1]:8444', 8444)).toBe(true)
    expect(adminHostsAllowed('127.0.0.1', 8444)).toBe(false)
    expect(adminHostsAllowed('evil.example:8444', 8444)).toBe(false)
    expect(adminHostsAllowed(undefined, 8444)).toBe(false)
    expect(adminHostsAllowed('127.0.0.1:8444', undefined)).toBe(false)
    expect(adminHostsAllowed('127.0.0.1', 80)).toBe(true)
  })

  it('rechaza el upgrade del panel con Host spoofeado', async () => {
    const bridge = await setup()
    const status = await bridge.wsStatus(`ws://127.0.0.1:${String(bridge.adminPort)}/api/mux`, { host: 'evil.example' })
    expect(status).toBe(403)
  })
})

describe('cross-site en el proxy', () => {
  it('rechaza POST cross-origin pero permite un cliente sin Origin', async () => {
    const bridge = await setup()
    await activate(bridge)
    const cross = await bridge.call('lan', '/api/echo', {
      method: 'POST',
      cookie: deviceCookie(),
      headers: { origin: 'https://evil.example' },
    })
    expect(cross.status).toBe(403)
    expect((cross.json.error as { code: string }).code).toBe('cross-origin')

    const noOrigin = await bridge.call('lan', '/api/echo', { method: 'POST', cookie: deviceCookie() })
    expect(noOrigin.status).toBe(200)
    expect(noOrigin.json.cookie).toBe('dsh-auth-test=v1.abc')
  })

  it('rechaza el WebSocket con Origin cruzado y permite sin Origin', async () => {
    const bridge = await setup()
    await activate(bridge)
    const url = `ws://127.0.0.1:${String(bridge.lanPort)}/api/mux`
    expect(await bridge.wsStatus(url, { cookie: deviceCookie(), origin: 'https://evil.example' })).toBe(403)
    expect(await bridge.wsStatus(url, { cookie: deviceCookie() })).toBe(0)
  })
})

describe('cookies malformadas', () => {
  it('responde 401 en HTTP y en upgrade sin tumbar el proceso', async () => {
    const bridge = await setup()
    await activate(bridge)

    const httpResponse = await bridge.call('lan', '/api/echo', { cookie: 'hm_device=%' })
    expect(httpResponse.status).toBe(401)
    expect((httpResponse.json.error as { code: string }).code).toBe('unpaired')

    const wsStatus = await bridge.wsStatus(`ws://127.0.0.1:${String(bridge.lanPort)}/api/mux`, { cookie: 'hm_device=%' })
    expect(wsStatus).toBe(401)

    const alive = await bridge.call('admin', '/_hm/api/v1/session')
    expect(alive.status).toBe(200)
  })
})

describe('métodos y cabeceras del proxy', () => {
  it('reenvía PUT, PATCH y OPTIONS al upstream', async () => {
    const bridge = await setup()
    await activate(bridge)
    for (const method of ['PUT', 'PATCH', 'OPTIONS'] as const) {
      const response = await bridge.call('lan', '/api/echo', { method, cookie: deviceCookie() })
      expect(response.status).toBe(200)
    }
    const echoed = bridge.upstream.requests.filter((entry) => entry.url === '/api/echo')
    expect(echoed.length).toBe(3)
    expect(echoed.every((entry) => entry.cookie === 'dsh-auth-test=v1.abc')).toBe(true)
  })

  it('no aplica la CSP propia a respuestas proxeadas', async () => {
    const bridge = await setup()
    await activate(bridge)
    const panel = await bridge.call('lan', '/_hm/')
    expect(panel.headers.get('content-security-policy')).toContain("default-src 'self'")

    const proxied = await bridge.call('lan', '/api/echo', { cookie: deviceCookie() })
    expect(proxied.status).toBe(200)
    expect(proxied.headers.get('content-security-policy')).toBeNull()
    expect(proxied.headers.get('x-frame-options')).toBeNull()
  })
})
