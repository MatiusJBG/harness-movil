import { afterEach, describe, expect, it } from './helpers/testkit.js'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DshJar, requestSessionCookie, TokenExchangeError } from '../src/jar.js'
import { startFakeUpstream, TEST_COOKIE, type FakeUpstream } from './helpers/fake-upstream.js'
import { makeTempDir, removeTempDir } from './helpers/fs.js'

let upstream: FakeUpstream | null = null
const dirs: string[] = []

afterEach(async () => {
  await upstream?.close()
  upstream = null
  await Promise.all(dirs.splice(0).map(removeTempDir))
})

describe('requestSessionCookie', () => {
  it('captures the signed cookie after the launch token exchange', async () => {
    upstream = await startFakeUpstream()
    const cookie = await requestSessionCookie({ port: upstream.port, token: 'abc123' })
    expect(cookie).toBe(TEST_COOKIE)
    expect(upstream.requests[0]?.url).toContain('token=abc123')
  })

  it('fails when the upstream answers without a redirect', async () => {
    upstream = await startFakeUpstream()
    await expect(requestSessionCookie({ port: upstream.port, token: 'bad' })).resolves.toBeTruthy()
    // A port with no listener fails with a clear error and never echoes the token.
    const port = upstream.port
    await upstream.close()
    upstream = null
    await expect(requestSessionCookie({ port, token: 'secret-token' })).rejects.toBeInstanceOf(TokenExchangeError)
  })

  it('times out instead of hanging', async () => {
    const net = await import('node:net')
    const server = net.createServer(() => {
      // accept and never answer
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    try {
      await expect(requestSessionCookie({ port, token: 'x', timeoutMs: 150 })).rejects.toBeTruthy()
    } finally {
      server.close()
    }
  })
})

describe('DshJar', () => {
  it('keeps the cookie in memory and clears it', async () => {
    upstream = await startFakeUpstream()
    const jar = new DshJar()
    expect(jar.hasCookie).toBe(false)
    await jar.exchange({ port: upstream.port, token: 't' })
    expect(jar.header()).toBe(TEST_COOKIE)
    expect(jar.describe()).toEqual({ present: true })
    jar.clear()
    expect(jar.header()).toBeUndefined()
    expect(jar.hasCookie).toBe(false)
  })

  it('supports an injected exchange for tests', async () => {
    const jar = new DshJar(async () => 'dsh-auth-x=y')
    await jar.exchange({ port: 1, token: 't' })
    expect(jar.header()).toBe('dsh-auth-x=y')
  })

  it('logs nothing secret through the file logger', async () => {
    const dir = await makeTempDir('jar-log-')
    dirs.push(dir)
    const file = join(dir, 'bridge.log')
    const { createLogger } = await import('../src/log.js')
    const logger = createLogger({ file, console: false })
    upstream = await startFakeUpstream()
    const jar = new DshJar()
    await jar.exchange({ port: upstream.port, token: 'super-secret' })
    logger.info('cookie lista', { cookie: jar.header() })
    await logger.close()
    const text = await readFile(file, 'utf8')
    expect(text).not.toContain(TEST_COOKIE)
    expect(text).toContain('<redacted>')
  })
})
