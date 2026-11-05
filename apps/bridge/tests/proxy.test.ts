import { createServer, request } from 'node:http'
import { afterEach, describe, expect, it } from './helpers/testkit.js'
import { WebSocket } from 'ws'
import { createBridgeProxy, rewriteLocation } from '../src/proxy.js'
import { TEST_COOKIE, startFakeUpstream, type FakeUpstream } from './helpers/fake-upstream.js'
import { silentLogger } from './helpers/logger.js'

let upstream: FakeUpstream | null = null
let bridge: ReturnType<typeof createServer> | null = null
let proxy: ReturnType<typeof createBridgeProxy> | null = null

afterEach(async () => {
  proxy?.close()
  proxy = null
  if (bridge) {
    bridge.closeAllConnections?.()
    await new Promise<void>((resolve) => bridge?.close(() => resolve()))
    bridge = null
  }
  await upstream?.close()
  upstream = null
})

async function startBridge(): Promise<number> {
  upstream = await startFakeUpstream()
  proxy = createBridgeProxy({
    logger: silentLogger,
    publicUrl: 'https://192.168.1.44:8443/',
    cookie: () => TEST_COOKIE,
  })
  const server = createServer((req, res) => proxy?.web(req, res, upstream!.port))
  server.on('upgrade', (req, socket, head) => proxy?.ws(req, socket, head, upstream!.port))
  bridge = server
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address()
  return typeof address === 'object' && address ? address.port : 0
}

function rawRequest(
  port: number,
  path: string,
  headers: Record<string, string>,
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET', headers }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () =>
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        }),
      )
    })
    req.on('error', reject)
    req.end()
  })
}

function wsOnce(url: string, headers: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers })
    socket.once('message', (data) => {
      socket.close()
      resolve(Buffer.isBuffer(data) ? data.toString('utf8') : String(data))
    })
    socket.once('error', reject)
  })
}

describe('rewriteLocation', () => {
  it('rewrites absolute loopback redirects to the public root', () => {
    expect(rewriteLocation('http://127.0.0.1:5555/elsewhere', 5555, 'https://192.168.1.44:8443/')).toBe(
      'https://192.168.1.44:8443/elsewhere',
    )
    expect(rewriteLocation('./', 5555, 'https://192.168.1.44:8443/')).toBe('./')
    expect(rewriteLocation('/relative', 5555, 'https://192.168.1.44:8443/')).toBe('/relative')
  })
})

describe('bridge proxy', () => {
  it('preserves the public Host rewrite, injects the DSH cookie and hides Set-Cookie', async () => {
    const port = await startBridge()
    const response = await rawRequest(port, '/api/echo', {
      host: '192.168.1.20:8443',
      cookie: 'hm_device=phone-token',
      origin: 'https://192.168.1.20:8443',
    })
    expect(response.status).toBe(200)
    expect(response.headers['set-cookie']).toBeUndefined()
    const body = JSON.parse(response.body) as { host: string; cookie: string; origin: string | null }
    expect(body.host).toBe(`127.0.0.1:${upstream!.port}`)
    expect(body.cookie).toBe(TEST_COOKIE)
    expect(body.origin).toBeNull()
    const seen = upstream!.requests.at(-1)
    expect(seen?.host).toBe(`127.0.0.1:${upstream!.port}`)
    expect(seen?.cookie).toBe(TEST_COOKIE)
  })

  it('rewrites an absolute loopback redirect', async () => {
    const port = await startBridge()
    const response = await rawRequest(port, '/api/absolute', { host: 'phone:8443' })
    expect(response.status).toBe(302)
    expect(response.headers.location).toBe('https://192.168.1.44:8443/absolute')
  })

  it('proxies WebSocket upgrades with the DSH cookie', async () => {
    const port = await startBridge()
    const message = await wsOnce(`ws://127.0.0.1:${port}/api/remote.mux`, {
      cookie: 'hm_device=phone-token',
      origin: 'https://192.168.1.20:8443',
    })
    const payload = JSON.parse(message) as { host: string; cookie: string }
    expect(payload.host).toBe(`127.0.0.1:${upstream!.port}`)
    expect(payload.cookie).toBe(TEST_COOKIE)
  })

  it('answers 502 when the upstream is unreachable', async () => {
    proxy = createBridgeProxy({
      logger: silentLogger,
      publicUrl: 'https://x/',
      cookie: () => TEST_COOKIE,
    })
    const server = createServer((req, res) => proxy?.web(req, res, 1))
    bridge = server
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    const response = await rawRequest(port, '/', {})
    expect(response.status).toBe(502)
  })
})
