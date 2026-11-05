import type { IncomingMessage, ServerResponse } from 'node:http'

export const DEVICE_COOKIE = 'hm_device'
export const CSRF_HEADER = 'x-hm-csrf'
export const DEVICE_COOKIE_MAX_AGE_SECONDS = 90 * 24 * 60 * 60

export function parseCookieHeader(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator <= 0) continue
    const name = part.slice(0, separator).trim()
    const value = part.slice(separator + 1).trim()
    if (name !== '') out[name] = decodeURIComponent(value)
  }
  return out
}

export function getCookie(req: IncomingMessage, name: string): string | null {
  return parseCookieHeader(req.headers.cookie)[name] ?? null
}

export function serializeDeviceCookie(token: string): string {
  return [
    `${DEVICE_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${DEVICE_COOKIE_MAX_AGE_SECONDS}`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
  ].join('; ')
}

export function serializeClearedDeviceCookie(): string {
  return `${DEVICE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`
}

export function requestIp(req: IncomingMessage): string {
  const address = req.socket.remoteAddress ?? ''
  return address.startsWith('::ffff:') ? address.slice(7) : address
}

export function isLoopbackRequest(req: IncomingMessage): boolean {
  const ip = requestIp(req)
  return ip === '127.0.0.1' || ip === '::1' || ip.startsWith('127.')
}

export function isSecureRequest(req: IncomingMessage): boolean {
  const socket = req.socket as { encrypted?: boolean }
  if (socket.encrypted) return true
  const forwarded = req.headers['x-forwarded-proto']
  return typeof forwarded === 'string' && forwarded.split(',')[0]?.trim() === 'https'
}

/** Same-origin guard for dashboard mutations. Proxy traffic never reaches this. */
export function sameOriginOk(req: IncomingMessage): boolean {
  const site = req.headers['sec-fetch-site']
  if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') return false
  const origin = req.headers.origin
  if (typeof origin !== 'string' || origin === '') return true
  const host = req.headers.host
  if (typeof host !== 'string' || host === '') return false
  const scheme = isSecureRequest(req) ? 'https' : 'http'
  return origin === `${scheme}://${host}`
}

export class RateLimiter {
  private readonly hits = new Map<string, number[]>()

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  tryConsume(key: string): boolean {
    const current = this.now()
    const recent = (this.hits.get(key) ?? []).filter((timestamp) => current - timestamp < this.windowMs)
    if (recent.length >= this.limit) {
      this.hits.set(key, recent)
      return false
    }
    recent.push(current)
    this.hits.set(key, recent)
    return true
  }

  reset(key?: string): void {
    if (key === undefined) this.hits.clear()
    else this.hits.delete(key)
  }
}

export class BodyTooLargeError extends Error {
  override name = 'BodyTooLargeError'
}

export class InvalidBodyError extends Error {
  override name = 'InvalidBodyError'
}

export async function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  const contentType = req.headers['content-type'] ?? ''
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new InvalidBodyError('Se esperaba content-type application/json')
  }
  const declared = Number(req.headers['content-length'] ?? '0')
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new BodyTooLargeError('El cuerpo del pedido es demasiado grande')
  }
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.length
    if (total > maxBytes) throw new BodyTooLargeError('El cuerpo del pedido es demasiado grande')
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text === '') return {}
  return JSON.parse(text)
}

export function sendJson(res: ServerResponse, status: number, body: unknown, extraHeaders: Record<string, string> = {}): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
    ...extraHeaders,
  })
  res.end(payload)
}

export function sendText(res: ServerResponse, status: number, body: string, contentType = 'text/plain; charset=utf-8'): void {
  res.writeHead(status, {
    'content-type': contentType,
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

export function redirect(res: ServerResponse, location: string, status = 302): void {
  res.writeHead(status, { location, 'cache-control': 'no-store', 'content-length': 0 })
  res.end()
}

export function wantsJson(req: IncomingMessage): boolean {
  const path = req.url ?? ''
  if (path.startsWith('/api/') || path.startsWith('/_hm/api/')) return true
  const accept = req.headers.accept ?? ''
  return accept.includes('application/json')
}
