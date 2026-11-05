export const PAIRING_CODE_LENGTH = 6

/** Normaliza lo que el usuario tipeó: solo dígitos, recortado a 6. */
export function normalizePairingCode(input: unknown): string {
  if (typeof input !== 'string') return ''
  return input.replace(/\D+/g, '').slice(0, PAIRING_CODE_LENGTH)
}

export function formatPairingCode(value: number): string {
  return String(value).padStart(PAIRING_CODE_LENGTH, '0')
}
