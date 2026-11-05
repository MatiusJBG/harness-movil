import { createServer, type Server } from 'node:http'
import { WebSocket } from 'ws'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from './helpers/testkit.js'
import { Activation } from '../src/activation.js'
import { loadConfig, type ResolvedConfig } from '../src/config.js'
import { createDashboard } from '../src/dashboard.js'
import { DeviceStore } from '../src/devices.js'
import { createRouter } from '../src/http.js'
import { createBridgeProxy } from '../src/proxy.js'
import { PairingService } from '../src/pairing.js'
import type { TlsMaterial } from '../src/tls.js'
import { TEST_COOKIE, startFakeUpstream, type FakeUpstream } from './helpers/fake-upstream.js'
import { makeTempDir, removeTempDir } from './helpers/fs.js'
import { silentLogger } from './helpers/logger.js'

const PUBLIC_DIR = join(process.cwd(), 'apps', 'bridge', 'public')

interface TestBridge {
  config: ResolvedConfig
  lanPort: number
  adminPort: number
  devices: DeviceStore
  pairing: PairingService
  activation: Activation
  upstream: FakeUpstream
  token: string
  deviceId: string
  call(
    listener: 'lan' | 'admin',
    path: string,
    options?: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string> },
  ): Promise<TestResponse>
  close(): Promise<void>
}

interface TestResponse {
  status: number
  headers: Headers
  text: string
  json: Record<string, unknown> & { error?: string }
  cookie: string | null
}

const bridges: TestBridge[] = []

afterEach(async () => {
  await Promise.all(bridges.splice(0).map((bridge) => bridge.close()))
})

function fakeTls(): TlsMaterial {
  return {
    certPem: 'cert',
    keyPem: 'key',
    caPem: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n',
    caDer: Buffer.from('der'),
    notAfter: new Date(Date.now() + 86_400_000),
    fingerprint: 'abc',
    sans: ['127.0.0.1'],
    reused: true,
  }
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (typeof address === 'object' && address) resolve(address.port)
      else reject(new Error('sin puerto'))
    })
  })
}

async function setup(maxDevices = 3): Promise<TestBridge> {
  const dir = await makeTempDir('router-')
  await writeFile(
    join(dir, 'config.json'),
    JSON.stringify({
      listen: { host: '127.0.0.1', port: 19443 },
      dsh: { home: join(dir, 'home') },
      pairing: { maxDevices },
      activation: { idleAutoOffMinutes: 0 },
      limits: { pairingPerMinute: 10 },
    }),
  )
  const config = await loadConfig({ dataDir: dir, env: {} })
  const devices = new DeviceStore(config.devicesFile)
  await devices.load()
  const created = await devices.add({ name: 'Phone', ip: '127.0.0.1', maxDevices })
  const pairing = new PairingService()
  const upstream = await startFakeUpstream()
  const supervisor = {
    start: vi.fn(async () => ({
      pid: 7,
      port: upstream.port,
      token: 'token',
      startedAt: Date.now(),
      command: 'dsh',
    })),
    stop: vi.fn(async () => undefined),
    running: vi.fn(() => true),
    onExit: () => () => undefined,
  }
  let jarHeader: string | undefined = TEST_COOKIE
  const jar = {
    exchange: vi.fn(async () => undefined),
    clear: vi.fn(() => {
      jarHeader = undefined
    }),
    header: () => jarHeader,
  }
  const activation = new Activation({
    supervisor,
    jar,
    logger: silentLogger,
    idleAutoOffMinutes: 0,
  })
  const proxy = createBridgeProxy({
    logger: silentLogger,
    publicUrl: config.publicUrl,
    cookie: () => jar.header(),
  })
  const dashboard = await createDashboard({
    config,
    devices,
    pairing,
    activation,
    tls: fakeTls(),
    logger: silentLogger,
    publicDir: PUBLIC_DIR,
    version: 'test',
  })
  const router = createRouter({ config, devices, activation, proxy, dashboard, logger: silentLogger })

  const lanServer = createServer((req, res) => {
    void router.handle(req, res, false)
  })
  lanServer.on('upgrade', (req, socket, head) => router.handleUpgrade(req, socket, head, false))
  const adminServer = createServer((req, res) => {
    void router.handle(req, res, true)
  })
  adminServer.on('upgrade', (req, socket, head) => router.handleUpgrade(req, socket, head, true))
  const lanPort = await listen(lanServer)
  const adminPort = await listen(adminServer)

  const call: TestBridge['call'] = async (listener, path, options = {}) => {
    const port = listener === 'lan' ? lanPort : adminPort
    const headers: Record<string, string> = { ...(options.headers ?? {}) }
    let body: string | undefined
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json'
      body = JSON.stringify(options.body)
    }
    if (options.cookie) headers.cookie = options.cookie
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body,
      redirect: 'manual',
    })
    const text = await response.text()
    let json: Record<string, unknown> = {}
    try {
      json = JSON.parse(text) as Record<string, unknown>
    } catch {
      json = {}
    }
    const setCookie = response.headers.getSetCookie?.() ?? []
    return {
      status: response.status,
      headers: response.headers,
      text,
      json: json as TestResponse['json'],
      cookie: setCookie[0] ?? response.headers.get('set-cookie'),
    }
  }

  const bridge: TestBridge = {
    config,
    lanPort,
    adminPort,
    devices,
    pairing,
    activation,
    upstream,
    token: created.token,
    deviceId: created.device.id,
    call,
    async close() {
      proxy.close()
      lanServer.closeAllConnections?.()
      adminServer.closeAllConnections?.()
      await Promise.all([
        new Promise<void>((resolve) => lanServer.close(() => resolve())),
        new Promise<void>((resolve) => adminServer.close(() => resolve())),
      ])
      await upstream.close()
      await removeTempDir(dir)
    },
  }
  bridges.push(bridge)
  return bridge
}

function headerCookie(token: string): string {
  return `hm_device=${token}`
}

function mutationHeaders(port: number): Record<string, string> {
  return { origin: `http://127.0.0.1:${port}`, 'x-hm-csrf': '1' }
}

/** Resolves 0 when the upgrade opens, otherwise the HTTP status of the refusal. */
function wsStatus(url: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve) => {
    const socket = new WebSocket(url, { headers })
    const timer = setTimeout(() => {
      socket.terminate()
      resolve(-1)
    }, 5_000)
    socket.once('open', () => {
      clearTimeout(timer)
      socket.close()
      resolve(0)
    })
    socket.once('unexpected-response', (_request, response) => {
      clearTimeout(timer)
      response.resume()
      resolve(response.statusCode ?? 0)
    })
    socket.once('error', () => {
      clearTimeout(timer)
      resolve(-2)
    })
  })
}

describe('bridge router', () => {
  it('redirects unpaired pages and refuses unpaired API calls', async () => {
    const bridge = await setup()
    const page = await bridge.call('lan', '/')
    expect(page.status).toBe(302)
    expect(page.headers.get('location')).toBe('/_hm/')
    const api = await bridge.call('lan', '/api/echo')
    expect(api.status).toBe(401)
    expect(api.json.error).toMatch(/emparejado/)
  })

  it('serves the pairing dashboard and session state', async () => {
    const bridge = await setup()
    const page = await bridge.call('lan', '/_hm/')
    expect(page.status).toBe(200)
    expect(page.text).toContain('Harness Móvil')
    expect(page.headers.get('content-security-policy')).toContain("default-src 'self'")
    const session = await bridge.call('lan', '/_hm/api/session')
    expect(session.json).toMatchObject({ paired: false, admin: false, active: false })
  })

  it('refuses paired devices while the connection is inactive', async () => {
    const bridge = await setup()
    const cookie = headerCookie(bridge.token)
    const api = await bridge.call('lan', '/api/echo', { cookie })
    expect(api.status).toBe(503)
    const page = await bridge.call('lan', '/', { cookie })
    expect(page.headers.get('location')).toBe('/_hm/?inactive=1')
  })

  it('pairs a device with a code and scopes its access', async () => {
    const bridge = await setup()
    const pairing = await bridge.call('admin', '/_hm/api/pairing')
    expect(pairing.status).toBe(200)
    expect(String(pairing.json.code)).toMatch(/^\d{6}$/)
    expect(String(pairing.json.qrDataUrl)).toMatch(/^data:image\/png;base64,/)
    expect(String(pairing.json.url)).toContain('/_hm/#p=')

    const paired = await bridge.call('lan', '/_hm/api/pair', {
      method: 'POST',
      headers: mutationHeaders(bridge.lanPort),
      body: { code: pairing.json.code, name: 'Test Phone' },
    })
    expect(paired.status).toBe(200)
    expect(paired.cookie).toContain('hm_device=')
    const cookie = paired.cookie!.split(';', 1)[0]!

    const session = await bridge.call('lan', '/_hm/api/session', { cookie })
    expect(session.json.paired).toBe(true)
    expect((session.json.device as { name: string }).name).toBe('Test Phone')

    const devices = await bridge.call('lan', '/_hm/api/devices', { cookie })
    expect(devices.json.admin).toBe(false)
    expect(devices.json.devices as unknown[]).toHaveLength(1)

    const diagnostics = await bridge.call('lan', '/_hm/api/diagnostics', { cookie })
    expect(diagnostics.status).toBe(403)
  })

  it('activates, proxies with the DSH cookie and rewrites redirects', async () => {
    const bridge = await setup()
    const cookie = headerCookie(bridge.token)
    const activated = await bridge.call('lan', '/_hm/api/activate', {
      method: 'POST',
      cookie,
      headers: mutationHeaders(bridge.lanPort),
    })
    expect(activated.status).toBe(202)

    await vi.waitFor(async () => {
      const status = await bridge.call('lan', '/_hm/api/status', { cookie })
      expect(status.json.state).toBe('active')
    })

    const echo = await bridge.call('lan', '/api/echo', { cookie })
    expect(echo.status).toBe(200)
    expect(echo.json.host).toBe(`127.0.0.1:${bridge.upstream.port}`)
    expect(echo.json.cookie).toBe(TEST_COOKIE)
    expect(echo.headers.getSetCookie()).toEqual([])

    const redirect = await bridge.call('lan', '/api/redirect', { cookie })
    expect(redirect.status).toBe(302)
    expect(redirect.headers.get('location')).toBe('/elsewhere')
  })

  it('lets the PC activate and browse without pairing', async () => {
    const bridge = await setup()
    const activated = await bridge.call('admin', '/_hm/api/activate', {
      method: 'POST',
      headers: mutationHeaders(bridge.adminPort),
    })
    expect(activated.status).toBe(202)
    await vi.waitFor(async () => {
      const status = await bridge.call('admin', '/_hm/api/status')
      expect(status.json.state).toBe('active')
    })
    const page = await bridge.call('admin', '/')
    expect(page.status).toBe(200)
    expect(page.text).toContain('fake upstream')
    const diagnostics = await bridge.call('admin', '/_hm/api/diagnostics')
    expect(diagnostics.status).toBe(200)
    expect(diagnostics.json.node).toBe(process.version)
  })

  it('rejects mutations without the CSRF header or from another origin', async () => {
    const bridge = await setup()
    const cookie = headerCookie(bridge.token)
    const noCsrf = await bridge.call('lan', '/_hm/api/activate', {
      method: 'POST',
      cookie,
      headers: { origin: `http://127.0.0.1:${bridge.lanPort}` },
    })
    expect(noCsrf.status).toBe(403)

    const wrongOrigin = await bridge.call('lan', '/_hm/api/activate', {
      method: 'POST',
      cookie,
      headers: { origin: 'https://evil.example', 'x-hm-csrf': '1' },
    })
    expect(wrongOrigin.status).toBe(403)
  })

  it('limits pairing attempts per IP', async () => {
    const bridge = await setup()
    await bridge.call('admin', '/_hm/api/pairing')
    let lastStatus = 0
    for (let attempt = 0; attempt < 11; attempt += 1) {
      const response = await bridge.call('lan', '/_hm/api/pair', {
        method: 'POST',
        headers: mutationHeaders(bridge.lanPort),
        body: { code: '000000', name: 'Brute' },
      })
      lastStatus = response.status
    }
    expect(lastStatus).toBe(429)
  })

  it('revokes a device and refuses its cookie afterwards', async () => {
    const bridge = await setup()
    const cookie = headerCookie(bridge.token)
    const activated = await bridge.call('lan', '/_hm/api/activate', {
      method: 'POST',
      cookie,
      headers: mutationHeaders(bridge.lanPort),
    })
    expect(activated.status).toBe(202)

    const revoked = await bridge.call('lan', `/_hm/api/devices/${bridge.deviceId}`, {
      method: 'DELETE',
      cookie,
      headers: mutationHeaders(bridge.lanPort),
    })
    expect(revoked.status).toBe(200)
    expect(revoked.cookie).toContain('Max-Age=0')

    const refused = await bridge.call('lan', '/api/echo', { cookie })
    expect(refused.status).toBe(401)
  })

  it('deactivates the connection', async () => {
    const bridge = await setup()
    const cookie = headerCookie(bridge.token)
    await bridge.call('lan', '/_hm/api/activate', {
      method: 'POST',
      cookie,
      headers: mutationHeaders(bridge.lanPort),
    })
    await vi.waitFor(() => expect(bridge.activation.isActive()).toBe(true))
    const deactivated = await bridge.call('lan', '/_hm/api/deactivate', {
      method: 'POST',
      cookie,
      headers: mutationHeaders(bridge.lanPort),
    })
    expect(deactivated.status).toBe(200)
    expect(deactivated.json.state).toBe('inactive')
    const api = await bridge.call('lan', '/api/echo', { cookie })
    expect(api.status).toBe(503)
  })

  it('refuses a device beyond the configured limit', async () => {
    const bridge = await setup(1)
    const pairing = await bridge.call('admin', '/_hm/api/pairing')
    const response = await bridge.call('lan', '/_hm/api/pair', {
      method: 'POST',
      headers: mutationHeaders(bridge.lanPort),
      body: { code: pairing.json.code, name: 'Second phone' },
    })
    expect(response.status).toBe(409)
  })

  it('returns 401 for a wrong pairing code', async () => {
    const bridge = await setup()
    await bridge.call('admin', '/_hm/api/pairing')
    const response = await bridge.call('lan', '/_hm/api/pair', {
      method: 'POST',
      headers: mutationHeaders(bridge.lanPort),
      body: { code: 'zzzzzz', name: 'Nope' },
    })
    expect(response.status).toBe(401)
  })

  it('serves the CA, the panel assets and HEAD requests', async () => {
    const bridge = await setup()
    const ca = await bridge.call('admin', '/_hm/ca.cer')
    expect(ca.status).toBe(200)
    expect(ca.headers.get('content-type')).toBe('application/x-x509-ca-cert')
    expect(ca.text.length).toBeGreaterThan(0)

    const pem = await bridge.call('admin', '/_hm/ca.pem')
    expect(pem.status).toBe(200)
    expect(pem.text).toContain('BEGIN CERTIFICATE')

    const css = await bridge.call('admin', '/_hm/styles.css')
    expect(css.status).toBe(200)
    expect(css.text).toContain('--bg')

    const head = await bridge.call('admin', '/_hm/', { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(head.text).toBe('')
  })

  it('rotates the pairing code from the PC', async () => {
    const bridge = await setup()
    const first = await bridge.call('admin', '/_hm/api/pairing')
    const refreshed = await bridge.call('admin', '/_hm/api/pairing/refresh', {
      method: 'POST',
      headers: mutationHeaders(bridge.adminPort),
    })
    expect(refreshed.status).toBe(200)
    expect(refreshed.json.expiresAt).not.toBe(first.json.expiresAt)
    const current = await bridge.call('admin', '/_hm/api/pairing')
    expect(current.json.code).toBe(refreshed.json.code)
  })

  it('lists every device for the PC and logs out the current phone', async () => {
    const bridge = await setup()
    const all = await bridge.call('admin', '/_hm/api/devices')
    expect(all.json.admin).toBe(true)
    expect(all.json.devices as unknown[]).toHaveLength(1)

    const cookie = headerCookie(bridge.token)
    const logout = await bridge.call('lan', '/_hm/api/logout', {
      method: 'POST',
      cookie,
      headers: mutationHeaders(bridge.lanPort),
    })
    expect(logout.status).toBe(200)
    expect(logout.cookie).toContain('Max-Age=0')
    const session = await bridge.call('lan', '/_hm/api/session', { cookie })
    expect(session.json.paired).toBe(false)
  })

  it('returns 404 for unknown dashboard routes once authenticated', async () => {
    const bridge = await setup()
    const response = await bridge.call('lan', '/_hm/api/missing', {
      cookie: headerCookie(bridge.token),
    })
    expect(response.status).toBe(404)
  })

  it('refuses WebSocket upgrades without a paired device and admits them when active', async () => {
    const bridge = await setup()
    const url = `ws://127.0.0.1:${bridge.lanPort}/api/remote.mux`

    expect(await wsStatus(url, {})).toBe(401)

    const cookie = headerCookie(bridge.token)
    expect(await wsStatus(url, { cookie })).toBe(503)

    await bridge.call('admin', '/_hm/api/activate', {
      method: 'POST',
      headers: mutationHeaders(bridge.adminPort),
    })
    await vi.waitFor(() => expect(bridge.activation.isActive()).toBe(true))
    expect(await wsStatus(url, { cookie })).toBe(0)
  })
})
