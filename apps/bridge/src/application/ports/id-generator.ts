/** Fuente de identificadores y secretos (adaptador: node:crypto). */
export interface IdGenerator {
  deviceId(): string
  deviceSecret(): string
  pairingSecret(): string
  pairingCodeValue(): number
}
