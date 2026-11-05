import type { IncomingMessage } from 'node:http'

export const DEVICE_COOKIE = 'hm_device'
export const CSRF_HEADER = 'x-hm-csrf'
export const DEVICE_COOKIE_MAX_AGE_SECONDS = 90 * 24 * 60 * 60

export function parseCookieHeader(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (header === undefined) return out
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
    `Max-Age=${String(DEVICE_COOKIE_MAX_AGE_SECONDS)}`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
  ].join('; ')
}

export function serializeClearedDeviceCookie(): string {
  return `${DEVICE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`
}
