import httpProxy from 'http-proxy'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import type { Logger } from './log.js'
import { sendJson } from './auth.js'

export interface BridgeProxy {
  /** Returns false when no upstream port is available. */
  web(req: IncomingMessage, res: ServerResponse, port: number): boolean
  ws(req: IncomingMessage, socket: Duplex, head: Buffer, port: number): boolean
  close(): void
}

export interface ProxyOptions {
  logger: Logger
  /** Public root advertised by the bridge, used to rewrite absolute redirects. */
  publicUrl: string
  cookie: () => string | undefined
}

const HOP_HEADERS = [
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
  'forwarded',
]

function prepareUpstream(req: IncomingMessage, port: number, cookie: string | undefined): void {
  req.headers.host = `127.0.0.1:${port}`
  delete req.headers.origin
  delete req.headers.referer
  delete req.headers['sec-fetch-site']
  delete req.headers['sec-fetch-mode']
  delete req.headers['sec-fetch-dest']
  for (const name of HOP_HEADERS) delete req.headers[name]
  delete req.headers.cookie
  if (cookie) req.headers.cookie = cookie
}

export function rewriteLocation(location: string, port: number, publicUrl: string): string {
  const root = publicUrl.replace(/\/$/, '')
  const needles = [`http://127.0.0.1:${port}`, `https://127.0.0.1:${port}`, `//127.0.0.1:${port}`]
  for (const needle of needles) {
    if (location.startsWith(needle)) return `${root}${location.slice(needle.length)}`
  }
  return location
}

export function createBridgeProxy(options: ProxyOptions): BridgeProxy {
  const logger = options.logger.child({ component: 'proxy' })
  const proxy = httpProxy.createProxyServer({
    ws: true,
    xfwd: false,
    changeOrigin: false,
    // Harness streams can stay open for minutes; never cut them from here.
    proxyTimeout: 0,
    timeout: 0,
  })

  proxy.on('proxyRes', (proxyRes, req) => {
    // Harness cookies stay on the PC; never leak them to the phone.
    delete proxyRes.headers['set-cookie']
    const location = proxyRes.headers.location
    if (typeof location === 'string') {
      proxyRes.headers.location = rewriteLocation(location, upstreamPortOf(req), options.publicUrl)
    }
  })

  proxy.on('error', (error, _req, res) => {
    logger.warn('error de proxy', { error: error.message })
    const response = res as ServerResponse
    if (response && typeof response.writeHead === 'function' && !response.headersSent) {
      sendJson(response, 502, { error: 'El host Harness no respondió.' })
      return
    }
    const socket = res as unknown as Duplex
    if (socket && typeof socket.destroy === 'function') socket.destroy()
  })

  return {
    web(req, res, port) {
      if (!port) return false
      prepareUpstream(req, port, options.cookie())
      proxy.web(req, res, { target: `http://127.0.0.1:${port}` })
      return true
    },
    ws(req, socket, head, port) {
      if (!port) return false
      prepareUpstream(req, port, options.cookie())
      proxy.ws(req, socket, head, { target: `http://127.0.0.1:${port}` })
      return true
    },
    close() {
      proxy.close()
    },
  }
}

/** Recovers the loopback port from the Host header the bridge rewrote upstream. */
function upstreamPortOf(req: IncomingMessage): number {
  const match = /^127\.0\.0\.1:(\d+)$/.exec(req.headers.host ?? '')
  return match ? Number(match[1]) : 0
}
