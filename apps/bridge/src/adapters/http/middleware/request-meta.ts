import type { IncomingMessage } from 'node:http'

export class BodyTooLargeError extends Error {
  override name = 'BodyTooLargeError'
  constructor() {
    super('El cuerpo del pedido es demasiado grande')
  }
}

export class InvalidBodyError extends Error {
  override name = 'InvalidBodyError'
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
  if (socket.encrypted === true) return true
  const forwarded = req.headers['x-forwarded-proto']
  return typeof forwarded === 'string' && forwarded.split(',')[0]?.trim() === 'https'
}

/** Guarda same-origin para mutaciones del panel; el tráfico proxeado no llega acá. */
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

export function wantsJson(req: IncomingMessage): boolean {
  const path = req.url ?? ''
  if (path.startsWith('/api/') || path.startsWith('/_hm/api/')) return true
  const accept = req.headers.accept ?? ''
  return accept.includes('application/json')
}

export async function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  const contentType = req.headers['content-type'] ?? ''
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new InvalidBodyError('Se esperaba content-type application/json')
  }
  const declared = Number(req.headers['content-length'] ?? '0')
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLargeError()
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    total += buffer.length
    if (total > maxBytes) throw new BodyTooLargeError()
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text === '') return {}
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new InvalidBodyError('El cuerpo no es JSON válido')
  }
}
