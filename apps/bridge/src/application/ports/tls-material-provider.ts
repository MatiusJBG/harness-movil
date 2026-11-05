export interface TlsMaterial {
  readonly certPem: string
  readonly keyPem: string
  readonly caPem: string | null
  /** DER para instalar en el teléfono; null si se usaron archivos externos. */
  readonly caDer: Uint8Array | null
  readonly notAfter: Date
  readonly fingerprint: string
  readonly sans: readonly string[]
  readonly reused: boolean
}

export interface TlsMaterialProvider {
  ensure(names: readonly string[]): Promise<TlsMaterial>
}
