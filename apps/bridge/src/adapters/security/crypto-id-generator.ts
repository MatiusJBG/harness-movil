import { randomBytes, randomInt } from 'node:crypto'
import type { IdGenerator } from '../../application/ports/id-generator.js'

export class CryptoIdGenerator implements IdGenerator {
  deviceId(): string {
    return randomBytes(8).toString('hex')
  }

  deviceSecret(): string {
    return randomBytes(32).toString('base64url')
  }

  pairingSecret(): string {
    return randomBytes(32).toString('base64url')
  }

  pairingCodeValue(): number {
    return randomInt(0, 1_000_000)
  }
}
