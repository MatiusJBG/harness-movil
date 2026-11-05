import { Readable } from 'node:stream'
import type { IncomingMessage } from 'node:http'
import { describe, expect, it } from './helpers/testkit.js'
import {
  BodyTooLargeError,
  InvalidBodyError,
  RateLimiter,
  getCookie,
  isLoopbackRequest,
  isSecureRequest,
  parseCookieHeader,
  readJsonBody,
  requestIp,
  sameOriginOk,
  serializeClearedDeviceCookie,
  serializeDeviceCookie,
  wantsJson,
} from '../src/auth.js'

function fakeRequest(overrides: {
  headers?: Record<string, string>
  remoteAddress?: string
  encrypted?: boolean
}): IncomingMessage {
  return {
    headers: { host: '192.168.1.44:8443', ...overrides.headers },
    socket: { remoteAddress: overrides.remoteAddress ?? '192.168.1.20', encrypted: overrides.encrypted ?? false },
    url: '/',
  } as unknown as IncomingMessage
}

describe('cookies', () => {
  it('parses cookie headers', () => {
    expect(parseCookieHeader('a=1; b=hello%20world; bad; c=')).toEqual({ a: '1', b: 'hello world', c: '' })
    expect(parseCookieHeader(undefined)).toEqual({})
  })

  it('serializes the device cookie with hardened attributes', () => {
    const serialized = serializeDeviceCookie('abc.def')
    expect(serialized).toContain('hm_device=abc.def')
    expect(serialized).toContain('HttpOnly')
    expect(serialized).toContain('Secure')
    expect(serialized).toContain('SameSite=Lax')
    expect(serialized).toContain('Path=/')
    expect(serializeClearedDeviceCookie()).toContain('Max-Age=0')
  })

  it('reads a named cookie', () => {
    expect(getCookie(fakeRequest({ headers: { cookie: 'x=1; hm_device=dev.token' } }), 'hm_device')).toBe('dev.token')
    expect(getCookie(fakeRequest({}), 'hm_device')).toBeNull()
  })
})

describe('request identity', () => {
  it('normalizes IPv4-mapped addresses', () => {
    expect(requestIp(fakeRequest({ remoteAddress: '::ffff:192.168.1.20' }))).toBe('192.168.1.20')
    expect(requestIp(fakeRequest({ remoteAddress: '::1' }))).toBe('::1')
  })

  it('detects loopback and TLS', () => {
    expect(isLoopbackRequest(fakeRequest({ remoteAddress: '127.0.0.1' }))).toBe(true)
    expect(isLoopbackRequest(fakeRequest({ remoteAddress: '::1' }))).toBe(true)
    expect(isLoopbackRequest(fakeRequest({ remoteAddress: '192.168.1.20' }))).toBe(false)
    expect(isSecureRequest(fakeRequest({ encrypted: true }))).toBe(true)
    expect(isSecureRequest(fakeRequest({ headers: { 'x-forwarded-proto': 'https' } }))).toBe(true)
    expect(isSecureRequest(fakeRequest({}))).toBe(false)
  })
})

describe('sameOriginOk', () => {
  it('accepts same-origin and absent-origin requests', () => {
    expect(
      sameOriginOk(fakeRequest({ headers: { origin: 'https://192.168.1.44:8443' }, encrypted: true })),
    ).toBe(true)
    expect(sameOriginOk(fakeRequest({}))).toBe(true)
  })

  it('rejects cross-site, foreign origins and missing hosts', () => {
    expect(
      sameOriginOk(fakeRequest({ headers: { 'sec-fetch-site': 'cross-site' }, encrypted: true })),
    ).toBe(false)
    expect(
      sameOriginOk(fakeRequest({ headers: { origin: 'https://evil.example' }, encrypted: true })),
    ).toBe(false)
    expect(
      sameOriginOk(
        fakeRequest({ headers: { origin: 'https://192.168.1.44:8443', host: '' }, encrypted: true }),
      ),
    ).toBe(false)
  })
})

describe('RateLimiter', () => {
  it('limits within the window and recovers afterwards', () => {
    let now = 0
    const limiter = new RateLimiter(2, 1_000, () => now)
    expect(limiter.tryConsume('ip')).toBe(true)
    expect(limiter.tryConsume('ip')).toBe(true)
    expect(limiter.tryConsume('ip')).toBe(false)
    now = 1_001
    expect(limiter.tryConsume('ip')).toBe(true)
    limiter.reset('ip')
    expect(limiter.tryConsume('ip')).toBe(true)
  })
})

describe('readJsonBody', () => {
  it('parses a JSON body', async () => {
    const req = Readable.from([Buffer.from('{"code":"123456"}')]) as unknown as IncomingMessage
    ;(req as unknown as { headers: Record<string, string> }).headers = {
      'content-type': 'application/json',
      'content-length': '17',
    }
    await expect(readJsonBody(req, 1_024)).resolves.toEqual({ code: '123456' })
  })

  it('returns an empty object for an empty body', async () => {
    const req = Readable.from([]) as unknown as IncomingMessage
    ;(req as unknown as { headers: Record<string, string> }).headers = { 'content-type': 'application/json' }
    await expect(readJsonBody(req, 1_024)).resolves.toEqual({})
  })

  it('rejects oversized bodies and wrong content types', async () => {
    const oversized = Readable.from([Buffer.from('{"a":1}')]) as unknown as IncomingMessage
    ;(oversized as unknown as { headers: Record<string, string> }).headers = {
      'content-type': 'application/json',
      'content-length': '999',
    }
    await expect(readJsonBody(oversized, 10)).rejects.toBeInstanceOf(BodyTooLargeError)

    const wrongType = Readable.from([Buffer.from('{}')]) as unknown as IncomingMessage
    ;(wrongType as unknown as { headers: Record<string, string> }).headers = { 'content-type': 'text/plain' }
    await expect(readJsonBody(wrongType, 1_024)).rejects.toBeInstanceOf(InvalidBodyError)
  })
})

describe('wantsJson', () => {
  it('detects API paths and JSON accepts', () => {
    expect(wantsJson({ url: '/api/session', headers: {} } as IncomingMessage)).toBe(true)
    expect(wantsJson({ url: '/_hm/api/status', headers: {} } as IncomingMessage)).toBe(true)
    expect(wantsJson({ url: '/', headers: { accept: 'application/json' } } as IncomingMessage)).toBe(true)
    expect(wantsJson({ url: '/', headers: { accept: 'text/html' } } as IncomingMessage)).toBe(false)
  })
})
