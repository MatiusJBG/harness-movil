const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/

export function isIpLiteral(value: string): boolean {
  return value.includes(':') || IPV4.test(value)
}

/** Deduplica y recorta: el orden importa porque define el nombre primario. */
export function normalizeSans(values: readonly string[]): string[] {
  const out: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    if (trimmed === '' || out.includes(trimmed)) continue
    out.push(trimmed)
  }
  return out
}

/**
 * Nombre común del certificado. Se conserva la semántica histórica (primer SAN
 * que no sea IPv6): el CN solo es cosmético, la confianza depende de los SAN.
 */
export function primaryName(sans: readonly string[]): string {
  return sans.find((value) => !value.includes(':')) ?? sans[0] ?? '127.0.0.1'
}

/** Un certificado sirve si cubre todos los nombres requeridos. */
export function coversSans(covered: readonly string[], required: readonly string[]): boolean {
  return required.every((san) => covered.includes(san))
}

export interface SubjectAlternativeName {
  readonly type: number
  readonly ip?: string
  readonly value?: string
}

/** Entrada SAN en el formato que espera node-forge (7 = IP, 2 = DNS). */
export function alternateFor(value: string): SubjectAlternativeName {
  return isIpLiteral(value) ? { type: 7, ip: value } : { type: 2, value }
}
