/** Hash de secretos de dispositivo; el adaptador usa SHA-256 + comparación constante. */
export interface SecretHasher {
  hash(secret: string): string
  matches(hash: string, secret: string): boolean
}
