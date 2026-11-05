import { describe, expect, it } from '../helpers/testkit.js'
import { CryptoIdGenerator } from '../../src/adapters/security/crypto-id-generator.js'
import { MemoryRateLimiter } from '../../src/adapters/security/memory-rate-limiter.js'
import { Sha256SecretHasher } from '../../src/adapters/security/sha256-secret-hasher.js'
import { InMemoryPairingTicketStore } from '../../src/adapters/pairing/in-memory-pairing-ticket-store.js'
import { createFakeClock } from '../helpers/fakes.js'

describe('hasher SHA-256', () => {
  it('hashea de forma determinista y compara en tiempo constante', () => {
    const hasher = new Sha256SecretHasher()
    const hash = hasher.hash('secreto')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hasher.hash('secreto')).toBe(hash)
    expect(hasher.matches(hash, 'secreto')).toBe(true)
    expect(hasher.matches(hash, 'otro')).toBe(false)
    expect(hasher.matches('abc', 'secreto')).toBe(false)
  })
})

describe('limitador de tasa', () => {
  it('permite hasta el límite y reinicia con la ventana', () => {
    const clock = createFakeClock()
    const limiter = new MemoryRateLimiter(2, 1_000, clock)
    expect(limiter.tryConsume('ip')).toBe(true)
    expect(limiter.tryConsume('ip')).toBe(true)
    expect(limiter.tryConsume('ip')).toBe(false)
    clock.advance(1_001)
    expect(limiter.tryConsume('ip')).toBe(true)
  })

  it('separa claves y se puede reiniciar', () => {
    const clock = createFakeClock()
    const limiter = new MemoryRateLimiter(1, 1_000, clock)
    expect(limiter.tryConsume('a')).toBe(true)
    expect(limiter.tryConsume('b')).toBe(true)
    expect(limiter.tryConsume('a')).toBe(false)
    limiter.reset('a')
    expect(limiter.tryConsume('a')).toBe(true)
    limiter.reset()
    expect(limiter.tryConsume('a')).toBe(true)
    expect(limiter.tryConsume('a')).toBe(false)
  })
})

describe('almacén de tickets', () => {
  it('emite un código de 6 dígitos y un secreto', () => {
    const store = new InMemoryPairingTicketStore(new CryptoIdGenerator())
    const ticket = store.issue(300_000, 1_000)
    expect(ticket.code).toMatch(/^\d{6}$/)
    expect(ticket.secret.length).toBeGreaterThan(20)
    expect(ticket.expiresAt).toBe(301_000)
    expect(store.current(1_000)).toBe(ticket)
  })

  it('vence y se limpia al consultarlo', () => {
    const store = new InMemoryPairingTicketStore(new CryptoIdGenerator())
    store.issue(1_000, 1_000)
    expect(store.current(2_001)).toBeNull()
    expect(store.redeem({ code: '000000' }, 2_001)).toBeNull()
  })

  it('se canjea una sola vez, con código o con secreto', () => {
    const ids = new CryptoIdGenerator()
    const store = new InMemoryPairingTicketStore(ids)
    const byCode = store.issue(300_000, 0)
    expect(store.redeem({ code: byCode.code }, 1)).not.toBeNull()
    expect(store.redeem({ code: byCode.code }, 1)).toBeNull()

    const bySecret = store.issue(300_000, 0)
    expect(store.redeem({ secret: bySecret.secret }, 1)).not.toBeNull()
    expect(store.current(1)).toBeNull()
  })

  it('rechaza credenciales incorrectas sin consumir el ticket', () => {
    const store = new InMemoryPairingTicketStore(new CryptoIdGenerator())
    const ticket = store.issue(300_000, 0)
    expect(store.redeem({ code: '999999' }, 1)).toBeNull()
    expect(store.redeem({ secret: 'otro' }, 1)).toBeNull()
    expect(store.current(1)).toBe(ticket)
    store.clear()
    expect(store.current(1)).toBeNull()
  })
})

describe('generador de identificadores', () => {
  it('produce ids y secretos con forma esperada', () => {
    const ids = new CryptoIdGenerator()
    expect(ids.deviceId()).toMatch(/^[0-9a-f]{16}$/)
    expect(ids.deviceSecret().length).toBeGreaterThan(20)
    expect(ids.pairingSecret()).not.toBe(ids.pairingSecret())
    for (let index = 0; index < 20; index += 1) {
      const code = ids.pairingCodeValue()
      expect(code).toBeGreaterThanOrEqual(0)
      expect(code).toBeLessThan(1_000_000)
    }
  })
})
