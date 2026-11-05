import { formatPairingCode } from '../../domain/pairing/pairing-code.js'
import { isTicketExpired, ticketMatches, type PairingCredentialInput, type PairingTicket } from '../../domain/pairing/pairing-ticket.js'
import type { IdGenerator } from '../../application/ports/id-generator.js'
import type { PairingTicketStore } from '../../application/ports/pairing-ticket-store.js'

/** Ticket único en memoria: el puente nunca persiste secretos de emparejamiento. */
export class InMemoryPairingTicketStore implements PairingTicketStore {
  private ticket: PairingTicket | null = null

  constructor(private readonly ids: IdGenerator) {}

  issue(ttlMs: number, issuedAtMs: number): PairingTicket {
    const ticket: PairingTicket = {
      code: formatPairingCode(this.ids.pairingCodeValue()),
      secret: this.ids.pairingSecret(),
      issuedAt: issuedAtMs,
      expiresAt: issuedAtMs + ttlMs,
    }
    this.ticket = ticket
    return ticket
  }

  current(nowMs: number): PairingTicket | null {
    if (this.ticket !== null && isTicketExpired(this.ticket, nowMs)) this.ticket = null
    return this.ticket
  }

  redeem(input: PairingCredentialInput, nowMs: number): PairingTicket | null {
    const ticket = this.current(nowMs)
    if (ticket === null || !ticketMatches(ticket, input)) return null
    this.ticket = null
    return ticket
  }

  clear(): void {
    this.ticket = null
  }
}
