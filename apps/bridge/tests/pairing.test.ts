import { describe, expect, it } from './helpers/testkit.js'
import { PairingService, normalizeCode, safeEqual } from '../src/pairing.js'

function clock(start = 1_800_000_000_000): { now: () => number; advance: (ms: number) => void } {
  let current = start
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms
    },
  }
}

describe('PairingService', () => {
  it('issues a six digit code and a high-entropy secret', () => {
    const pairing = new PairingService()
    const ticket = pairing.issue(60_000)
    expect(ticket.code).toMatch(/^\d{6}$/)
    expect(ticket.secret.length).toBeGreaterThanOrEqual(40)
    expect(pairing.current()?.secret).toBe(ticket.secret)
  })

  it('verifies and consumes once', () => {
    const pairing = new PairingService()
    const ticket = pairing.issue(60_000)
    expect(pairing.verify({ code: ticket.code })).toBe(true)
    expect(pairing.verify({ code: ticket.code })).toBe(true)
    pairing.consume()
    expect(pairing.verify({ code: ticket.code })).toBe(false)
    expect(pairing.current()).toBeNull()
  })

  it('accepts the QR secret as well as the code', () => {
    const pairing = new PairingService()
    const ticket = pairing.issue(60_000)
    expect(pairing.redeem({ secret: ticket.secret })).toBe(true)
    expect(pairing.redeem({ secret: ticket.secret })).toBe(false)
  })

  it('rejects wrong codes and expired tickets', () => {
    const time = clock()
    const pairing = new PairingService(time.now)
    const ticket = pairing.issue(1_000)
    expect(pairing.verify({ code: '000000' === ticket.code ? '111111' : '000000' })).toBe(false)
    time.advance(1_001)
    expect(pairing.verify({ code: ticket.code })).toBe(false)
    expect(pairing.current()).toBeNull()
  })

  it('can be cleared explicitly', () => {
    const pairing = new PairingService()
    pairing.issue(60_000)
    pairing.clear()
    expect(pairing.current()).toBeNull()
  })
})

describe('normalizeCode', () => {
  it('keeps at most six digits', () => {
    expect(normalizeCode(' 12-34 56 78')).toBe('123456')
    expect(normalizeCode('abc')).toBe('')
    expect(normalizeCode(123)).toBe('')
  })
})

describe('safeEqual', () => {
  it('compares only equal-length values', () => {
    expect(safeEqual('abc', 'abc')).toBe(true)
    expect(safeEqual('abc', 'abd')).toBe(false)
    expect(safeEqual('abc', 'ab')).toBe(false)
  })
})
