import type { PairingCredentialInput, PairingTicket } from '../../domain/pairing/pairing-ticket.js'

/**
 * `redeem` es síncrono y de un solo uso: verifica y consume el ticket en el
 * mismo tick, de modo que dos pedidos concurrentes no puedan canjearlo dos veces.
 */
export interface PairingTicketStore {
  issue(ttlMs: number, issuedAtMs: number): PairingTicket
  current(nowMs: number): PairingTicket | null
  redeem(input: PairingCredentialInput, nowMs: number): PairingTicket | null
  clear(): void
}
