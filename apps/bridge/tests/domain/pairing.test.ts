import { describe, expect, it } from '../helpers/testkit.js'
import { formatPairingCode, normalizePairingCode } from '../../src/domain/pairing/pairing-code.js'
import { isTicketExpired, ticketMatches } from '../../src/domain/pairing/pairing-ticket.js'

const ticket = { code: '042317', secret: 'secreto-largo', issuedAt: 1_000, expiresAt: 2_000 }

describe('código de emparejamiento', () => {
  it('normaliza a dígitos y seis posiciones', () => {
    expect(normalizePairingCode(' 04-23 17 ')).toBe('042317')
    expect(normalizePairingCode('1234567899')).toBe('123456')
    expect(normalizePairingCode(undefined)).toBe('')
    expect(normalizePairingCode('abc')).toBe('')
  })

  it('formatea con ceros a la izquierda', () => {
    expect(formatPairingCode(7)).toBe('000007')
    expect(formatPairingCode(999_999)).toBe('999999')
  })
})

describe('ticket de emparejamiento', () => {
  it('vence cuando expiresAt no supera el ahora', () => {
    expect(isTicketExpired(ticket, 1_999)).toBe(false)
    expect(isTicketExpired(ticket, 2_000)).toBe(true)
    expect(isTicketExpired(ticket, 5_000)).toBe(true)
  })

  it('acepta el código normalizado o el secreto del QR', () => {
    expect(ticketMatches(ticket, { code: '04 23 17' })).toBe(true)
    expect(ticketMatches(ticket, { secret: 'secreto-largo' })).toBe(true)
  })

  it('rechaza código incorrecto, secreto incorrecto y datos vacíos', () => {
    expect(ticketMatches(ticket, { code: '000000' })).toBe(false)
    expect(ticketMatches(ticket, { secret: 'otro' })).toBe(false)
    expect(ticketMatches(ticket, {})).toBe(false)
    expect(ticketMatches(ticket, { code: '', secret: '' })).toBe(false)
  })
})
