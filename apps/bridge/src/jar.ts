import { request } from 'node:http'

export interface ExchangeOptions {
  port: number
  token: string
  timeoutMs?: number
}

export class TokenExchangeError extends Error {
  override name = 'TokenExchangeError'
}

/**
 * Calls the launch-token exchange on a loopback Harness listener and keeps the
 * resulting signed cookie in memory. The cookie never reaches the phone.
 */
export async function requestSessionCookie(options: ExchangeOptions): Promise<string> {
  const timeoutMs = options.timeoutMs ?? 15_000
  return new Promise<string>((resolve, reject) => {
    let settled = false
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      reject(error)
    }
    const succeed = (cookie: string) => {
      if (settled) return
      settled = true
      resolve(cookie)
    }

    const req = request(
      {
        host: '127.0.0.1',
        port: options.port,
        path: `/?token=${encodeURIComponent(options.token)}`,
        method: 'GET',
        headers: {
          accept: 'text/html',
          connection: 'close',
          'user-agent': 'harness-movil-bridge',
        },
        timeout: timeoutMs,
      },
      (res) => {
        const status = res.statusCode ?? 0
        const setCookie = res.headers['set-cookie']
        res.resume()
        if (status < 300 || status >= 400) {
          fail(new TokenExchangeError(`El intercambio de token devolvió ${status} (se esperaba una redirección)`))
          return
        }
        const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []
        const raw = cookies.find((value) => value.startsWith('dsh-auth-'))
        if (!raw) {
          fail(new TokenExchangeError('El intercambio de token no devolvió la cookie dsh-auth-*'))
          return
        }
        const pair = raw.split(';', 1)[0] ?? ''
        if (!pair.includes('=')) {
          fail(new TokenExchangeError('La cookie devuelta por Harness está malformada'))
          return
        }
        succeed(pair)
      },
    )

    req.on('timeout', () => {
      req.destroy(new TokenExchangeError('Tiempo agotado esperando el intercambio de token'))
    })
    req.on('error', (error) => fail(new TokenExchangeError(`No se pudo intercambiar el token: ${error.message}`)))
    req.end()
  })
}

export class DshJar {
  private cookie: string | null = null

  constructor(private readonly exchangeImpl: typeof requestSessionCookie = requestSessionCookie) {}

  get hasCookie(): boolean {
    return this.cookie !== null
  }

  header(): string | undefined {
    return this.cookie ?? undefined
  }

  async exchange(options: ExchangeOptions): Promise<void> {
    this.cookie = await this.exchangeImpl(options)
  }

  clear(): void {
    this.cookie = null
  }

  /** Test/observability helper: shows whether a cookie exists without revealing it. */
  describe(): { present: boolean } {
    return { present: this.cookie !== null }
  }
}
