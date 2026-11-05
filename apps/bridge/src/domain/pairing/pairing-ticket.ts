import { normalizePairingCode } from './pairing-code.js'
import { timingSafeEquals } from '../shared/timing-safe-equals.js'

export interface PairingTicket {
  readonly code: string
  readonly secret: string
  readonly issuedAt: number
  readonly expiresAt: number
}

export interface PairingCredentialInput {
  code?: string
  secret?: string
}

export function isTicketExpired(ticket: PairingTicket, nowMs: number): boolean {
  return ticket.expiresAt <= nowMs
}

/**
 * Un ticket se canjea con el secreto del QR **o** con el código de 6 dígitos.
 * La comparación es de longitud constante en ambos casos.
 */
export function ticketMatches(ticket: PairingTicket, input: PairingCredentialInput): boolean {
  const code = normalizePairingCode(input.code)
  const secret = typeof input.secret === 'string' ? input.secret : ''
  const codeOk = code !== '' && timingSafeEquals(code, ticket.code)
  const secretOk = secret !== '' && timingSafeEquals(secret, ticket.secret)
  return codeOk || secretOk
}
