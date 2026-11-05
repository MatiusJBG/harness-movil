import { afterEach, describe, expect, it, vi } from '../helpers/testkit.js'
import { TEST_COOKIE } from '../helpers/fake-upstream.js'
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

async function activate(bridge: TestBridge): Promise<void> {
  await bridge.call('lan', '/_hm/api/v1/activation', {
    method: 'POST',
    cookie: deviceCookie(),
    headers: mutationHeaders(bridge.lanPort),
  })
  await vi.waitFor(() => {
    expect(bridge.activation.state()).toBe('active')
  })
}

describe('HTTP: assets y certificado', () => {
  it('sirve el panel y sus assets con caché correcta', async () => {
    const bridge = await setup()
    const index = await bridge.call('lan', '/_hm/')
    expect(index.status).toBe(200)
    expect(index.headers.get('cache-control')).toBe('no-store')

    const script = await bridge.call('lan', '/_hm/js/main.js')
    expect(script.status).toBe(200)
    expect(script.headers.get('content-type')).toContain('text/javascript')
    expect(script.headers.get('cache-control')).toBe('no-store')

    const client = await bridge.call('lan', '/_hm/js/api-client.js')
    expect(client.status).toBe(200)
    expect(client.text).toContain('createApiClient')

    const icon = await bridge.call('lan', '/_hm/icon.svg')
    expect(icon.status).toBe(200)
    expect(icon.headers.get('cache-control')).toBe('public, max-age=300')
  })

  it('no permite traversal y responde 404 uniforme', async () => {
    const bridge = await setup()
    const traversal = await bridge.call('lan', '/_hm/..%2Fpackage.json')
    expect(traversal.status).toBe(404)
    const missing = await bridge.call('lan', '/_hm/no-existe.js')
    expect(missing.status).toBe(404)
    expect((missing.json.error as { code: string }).code).toBe('not-found')
  })

  it('atiende HEAD sin cuerpo', async () => {
    const bridge = await setup()
    const response = await fetch(`http://127.0.0.1:${String(bridge.lanPort)}/_hm/js/main.js`, { method: 'HEAD' })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('')
    expect(Number(response.headers.get('content-length'))).toBeGreaterThan(0)
  })

  it('entrega la CA en DER y PEM, también en las rutas históricas', async () => {
    const bridge = await setup()
    const der = await bridge.call('lan', '/_hm/api/v1/tls/ca.der')
    expect(der.status).toBe(200)
    expect(der.headers.get('content-type')).toBe('application/x-x509-ca-cert')
    expect(der.headers.get('content-disposition')).toContain('harness-movil-ca.cer')

    for (const path of ['/_hm/api/v1/tls/ca.pem', '/_hm/ca.pem', '/_hm/ca.cer']) {
      const response = await bridge.call('lan', path)
      expect(response.status).toBe(200)
    }
  })

  it('explica por qué no hay CA local cuando el TLS es externo', async () => {
    const bridge = await setup({
      tls: {
        certPem: 'cert',
        keyPem: 'key',
        caPem: null,
        caDer: null,
        notAfter: new Date(Date.now() + 86_400_000),
        fingerprint: 'abc',
        sans: [],
        reused: true,
      },
    })
    const response = await bridge.call('lan', '/_hm/api/v1/tls/ca.der')
    expect(response.status).toBe(404)
    expect((response.json.error as { code: string }).code).toBe('no-local-ca')
  })
})

describe('HTTP: diagnóstico', () => {
  it('solo el panel de la PC ve el diagnóstico', async () => {
    const bridge = await setup()
    const denied = await bridge.call('lan', '/_hm/api/v1/diagnostics', { cookie: deviceCookie() })
    expect(denied.status).toBe(403)

    const allowed = await bridge.call('admin', '/_hm/api/v1/diagnostics')
    expect(allowed.status).toBe(200)
    expect(allowed.json.dataDir).toBe(bridge.settings.paths.dataDir)
    expect(allowed.json.bind).toBe('127.0.0.1:19443')
    expect(String(allowed.json.node)).toContain('v')
  })
})

describe('HTTP: proxy hacia Harness', () => {
  it('proxea con Host loopback, cookie de Harness y sin filtrar Set-Cookie', async () => {
    const bridge = await setup()
    await activate(bridge)

    const echo = await bridge.call('lan', '/api/echo', { cookie: deviceCookie() })
    expect(echo.status).toBe(200)
    expect(echo.json.host).toBe(`127.0.0.1:${String(bridge.upstream.port)}`)
    expect(echo.json.cookie).toBe(TEST_COOKIE)
    expect(echo.json.origin).toBeNull()
    expect(echo.headers.get('set-cookie')).toBeNull()
  })

  it('reescribe redirecciones absolutas al host público', async () => {
    const bridge = await setup()
    await activate(bridge)

    const relative = await bridge.call('lan', '/api/redirect', { cookie: deviceCookie() })
    expect(relative.status).toBe(302)
    expect(relative.headers.get('location')).toBe('/elsewhere')

    const absolute = await bridge.call('lan', '/api/absolute', { cookie: deviceCookie() })
    expect(absolute.status).toBe(302)
    expect(absolute.headers.get('location')).toBe('https://127.0.0.1:19443/absolute')
  })

  it('responde 502 si el upstream no está disponible', async () => {
    const bridge = await setup()
    await activate(bridge)
    await bridge.upstream.close()
    const response = await bridge.call('lan', '/api/echo', { cookie: deviceCookie() })
    expect(response.status).toBe(502)
    expect((response.json.error as { code: string }).code).toBe('harness-unreachable')
  })

  it('proxea WebSocket solo con dispositivo emparejado y conexión activa', async () => {
    const bridge = await setup()
    const url = `ws://127.0.0.1:${String(bridge.lanPort)}/api/mux`
    expect(await bridge.wsStatus(url, {})).toBe(401)

    await activate(bridge)
    expect(await bridge.wsStatus(url, { cookie: deviceCookie() })).toBe(0)

    await bridge.activation.deactivate('test')
    expect(await bridge.wsStatus(url, { cookie: deviceCookie() })).toBe(503)
  })
})
