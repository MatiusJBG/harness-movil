import { createServer, type IncomingMessage, type Server } from 'node:http'
import { WebSocketServer } from 'ws'

export interface UpstreamRequest {
  url: string
  host: string | undefined
  cookie: string | undefined
  origin: string | undefined
}

export interface FakeUpstream {
  port: number
  requests: UpstreamRequest[]
  close(): Promise<void>
}

export const TEST_COOKIE = 'dsh-auth-test=v1.abc'

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

function record(req: IncomingMessage, requests: UpstreamRequest[]): void {
  requests.push({
    url: req.url ?? '',
    host: req.headers.host,
    cookie: req.headers.cookie,
    origin: req.headers.origin,
  })
}

export async function startFakeUpstream(): Promise<FakeUpstream> {
  const requests: UpstreamRequest[] = []
  const server = createServer((req, res) => {
    record(req, requests)
    const url = req.url ?? ''
    if (url.startsWith('/?token=')) {
      res.writeHead(303, {
        location: './',
        'set-cookie': `${TEST_COOKIE}; Path=/; HttpOnly; SameSite=Strict`,
      })
      res.end()
      return
    }
    if (url === '/api/redirect') {
      res.writeHead(302, { location: '/elsewhere' })
      res.end()
      return
    }
    if (url === '/api/absolute') {
      res.writeHead(302, { location: `http://127.0.0.1:${(server.address() as { port: number }).port}/absolute` })
      res.end()
      return
    }
    if (req.headers.cookie !== TEST_COOKIE) {
      res.writeHead(401, { 'content-type': 'text/plain' })
      res.end('unauthorized')
      return
    }
    if (url === '/api/echo') {
      res.writeHead(200, {
        'content-type': 'application/json',
        'set-cookie': 'leak=1; Path=/; HttpOnly',
        'cache-control': 'no-store',
      })
      res.end(
        JSON.stringify({
          host: req.headers.host,
          cookie: req.headers.cookie,
          origin: req.headers.origin ?? null,
        }),
      )
      return
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end('<html><body>fake upstream</body></html>')
  })

  const wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (req, socket, head) => {
    record(req, requests)
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.send(JSON.stringify({ host: req.headers.host, cookie: req.headers.cookie }))
      ws.close()
    })
  })

  const port = await listen(server)
  return {
    port,
    requests,
    async close() {
      await new Promise<void>((resolve) => wss.close(() => resolve()))
      server.closeAllConnections?.()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
