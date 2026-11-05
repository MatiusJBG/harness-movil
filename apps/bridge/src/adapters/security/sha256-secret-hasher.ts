import { createHash, timingSafeEqual } from 'node:crypto'
import type { SecretHasher } from '../../application/ports/secret-hasher.js'

/** Los tokens de dispositivo solo se guardan como SHA-256 hexadecimal. */
export class Sha256SecretHasher implements SecretHasher {
  hash(secret: string): string {
    return createHash('sha256').update(secret).digest('hex')
  }

  matches(hash: string, secret: string): boolean {
    const candidate = this.hash(secret)
    if (candidate.length !== hash.length) return false
    try {
      return timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(hash, 'hex'))
    } catch {
      return false
    }
  }
}
