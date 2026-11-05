import { request } from 'node:http'
import { HarnessStartError } from '../../application/errors.js'
import type { SessionCookieStore } from '../../application/ports/session-cookie-store.js'

/** Alias histórico: el fallo del intercambio es un fallo de arranque de Harness. */
export const TokenExchangeError = HarnessStartError

export interface ExchangeOptions {
  readonly port: number
  readonly token: string
  readonly timeoutMs?: number
}

/**
 * Cambia el token de lanzamiento por la cookie firmada de Harness. La cookie se
 * queda en memoria de la PC y nunca se entrega al teléfono.
 */
export async function requestSessionCookie(options: ExchangeOptions): Promise<string> {
  const timeoutMs = options.timeoutMs ?? 15_000
  return new Promise<string>((resolve, reject) => {
    let settled = false
    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      reject(error)
    }
    const succeed = (cookie: string): void => {
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
        headers: { accept: 'text/html', connection: 'close', 'user-agent': 'harness-movil-bridge' },
        timeout: timeoutMs,
      },
      (res) => {
        const status = res.statusCode ?? 0
        const setCookie = res.headers['set-cookie']
        res.resume()
        if (status < 300 || status >= 400) {
          fail(new TokenExchangeError(`El intercambio de token devolvió ${String(status)} (se esperaba una redirección)`))
          return
        }
        const cookies = Array.isArray(setCookie) ? setCookie : []
        const raw = cookies.find((value) => value.startsWith('dsh-auth-'))
        if (raw === undefined) {
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
    req.on('error', (error) => {
      fail(new TokenExchangeError(`No se pudo intercambiar el token: ${error.message}`))
    })
    req.end()
  })
}

export class HttpSessionCookieStore implements SessionCookieStore {
  private cookie: string | null = null

  constructor(private readonly exchangeImpl: typeof requestSessionCookie = requestSessionCookie) {}

  async exchange(input: { port: number; token: string }): Promise<void> {
    this.cookie = await this.exchangeImpl(input)
  }

  clear(): void {
    this.cookie = null
  }

  header(): string | undefined {
    return this.cookie ?? undefined
  }
}
