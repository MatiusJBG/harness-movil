import httpProxy from 'http-proxy'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import type { BridgeProxy, BridgeProxyOptions } from './proxy-port.js'

const HOP_HEADERS: readonly string[] = ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip', 'forwarded']

function prepareUpstream(req: IncomingMessage, port: number, cookie: string | undefined): void {
  req.headers.host = `127.0.0.1:${String(port)}`
  delete req.headers.origin
  delete req.headers.referer
  delete req.headers['sec-fetch-site']
  delete req.headers['sec-fetch-mode']
  delete req.headers['sec-fetch-dest']
  for (const name of HOP_HEADERS) Reflect.deleteProperty(req.headers, name)
  delete req.headers.cookie
  if (cookie !== undefined) req.headers.cookie = cookie
}

export function rewriteLocation(location: string, port: number, publicUrl: string): string {
  const root = publicUrl.replace(/\/$/, '')
  const needles = [
    `http://127.0.0.1:${String(port)}`,
    `https://127.0.0.1:${String(port)}`,
    `//127.0.0.1:${String(port)}`,
  ]
  for (const needle of needles) {
    if (location.startsWith(needle)) return `${root}${location.slice(needle.length)}`
  }
  return location
}

/** Recupera el puerto loopback del Host que el propio puente reescribió. */
function upstreamPortOf(req: IncomingMessage): number {
  const match = /^127\.0\.0\.1:(\d+)$/.exec(req.headers.host ?? '')
  return match === null ? 0 : Number(match[1])
}

export function createHttpProxy(options: BridgeProxyOptions): BridgeProxy {
  const logger = options.logger.child({ component: 'proxy' })
  const proxy = httpProxy.createProxyServer({
    ws: true,
    xfwd: false,
    changeOrigin: false,
    // Los streams de Harness pueden quedar abiertos minutos: no cortar desde acá.
    proxyTimeout: 0,
    timeout: 0,
  })

  proxy.on('proxyRes', (proxyRes, req) => {
    // Las cookies de Harness se quedan en la PC.
    delete proxyRes.headers['set-cookie']
    const location = proxyRes.headers.location
    if (typeof location === 'string') {
      proxyRes.headers.location = rewriteLocation(location, upstreamPortOf(req), options.publicUrl)
    }
  })

  proxy.on('error', (error, _req, res) => {
    logger.warn('error de proxy', { error: error.message })
    const response = res as ServerResponse
    if (typeof response.writeHead === 'function' && !response.headersSent) {
      const payload = JSON.stringify({ error: { code: 'harness-unreachable', message: 'El host Harness no respondió.' } })
      response.writeHead(502, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload) })
      response.end(payload)
      return
    }
    const socket = res as unknown as Duplex
    socket.destroy()
  })

  return {
    web: (req, res, port): boolean => {
      if (port <= 0) return false
      prepareUpstream(req, port, options.cookie())
      proxy.web(req, res, { target: `http://127.0.0.1:${String(port)}` })
      return true
    },
    ws: (req, socket, head, port): boolean => {
      if (port <= 0) return false
      prepareUpstream(req, port, options.cookie())
      proxy.ws(req, socket, head, { target: `http://127.0.0.1:${String(port)}` })
      return true
    },
    close: (): void => {
      proxy.close()
    },
  }
}
