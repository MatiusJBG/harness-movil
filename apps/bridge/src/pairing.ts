import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto'

export interface PairingTicket {
  code: string
  secret: string
  issuedAt: number
  expiresAt: number
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export function normalizeCode(input: unknown): string {
  if (typeof input !== 'string') return ''
  return input.replace(/\D+/g, '').slice(0, 6)
}

export class PairingService {
  private ticket: PairingTicket | null = null

  constructor(private readonly now: () => number = () => Date.now()) {}

  issue(ttlMs: number): PairingTicket {
    const issuedAt = this.now()
    const ticket: PairingTicket = {
      code: String(randomInt(0, 1_000_000)).padStart(6, '0'),
      secret: randomBytes(32).toString('base64url'),
      issuedAt,
      expiresAt: issuedAt + ttlMs,
    }
    this.ticket = ticket
    return ticket
  }

  current(): PairingTicket | null {
    if (!this.ticket) return null
    if (this.ticket.expiresAt <= this.now()) {
      this.ticket = null
      return null
    }
    return this.ticket
  }

  /** Checks the ticket without consuming it. Accepts the QR secret or the 6-digit code. */
  verify(input: { code?: string; secret?: string }): boolean {
    const ticket = this.current()
    if (!ticket) return false
    const code = normalizeCode(input.code)
    const secret = typeof input.secret === 'string' ? input.secret : ''
    return (code !== '' && safeEqual(code, ticket.code)) || (secret !== '' && safeEqual(secret, ticket.secret))
  }

  /** Call only after `verify` succeeded and the device was persisted. */
  consume(): void {
    this.ticket = null
  }

  /** Consumes the ticket on success. Accepts either the QR secret or the 6-digit code. */
  redeem(input: { code?: string; secret?: string }): boolean {
    if (!this.verify(input)) return false
    this.ticket = null
    return true
  }

  /** Invalidates the current ticket, e.g. after too many failed attempts. */
  clear(): void {
    this.ticket = null
  }
}
