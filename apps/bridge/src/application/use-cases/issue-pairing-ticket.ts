import type { PairingTicket } from '../../domain/pairing/pairing-ticket.js'
import type { Clock } from '../ports/clock.js'
import type { PairingTicketStore } from '../ports/pairing-ticket-store.js'

export interface PairingTicketDeps {
  readonly tickets: PairingTicketStore
  readonly clock: Clock
  readonly ttlSeconds: number
}

/** Devuelve el ticket vigente o emite uno nuevo si venció/no existe. */
export function readPairingTicket(deps: PairingTicketDeps): PairingTicket {
  const nowMs = deps.clock.nowMs()
  return deps.tickets.current(nowMs) ?? deps.tickets.issue(deps.ttlSeconds * 1_000, nowMs)
}

/** Invalida el anterior y emite uno nuevo (botón "Generar código nuevo"). */
export function refreshPairingTicket(deps: PairingTicketDeps): PairingTicket {
  return deps.tickets.issue(deps.ttlSeconds * 1_000, deps.clock.nowMs())
}
