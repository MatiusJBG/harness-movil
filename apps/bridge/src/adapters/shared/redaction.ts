import type { LogFields } from '../../application/ports/logger.js'

const SECRET_KEY = /token|secret|cookie|password|authorization|passwd/i
const SECRET_PATTERN = /\b(token|secret|cookie|authorization|password)=([^\s&"']+)/gi
const DSH_COOKIE_PATTERN = /dsh-auth-[A-Za-z0-9_-]+=[^\s;,"']+/g
const MAX_DEPTH = 4

/** Oculta secretos en texto libre (URLs con token, cookies de Harness). */
export function scrubString(value: string): string {
  return value
    .replace(SECRET_PATTERN, (_match, key: string) => `${key}=<redacted>`)
    .replace(DSH_COOKIE_PATTERN, 'dsh-auth-<redacted>')
}

export function redactFields(fields: LogFields | undefined, depth = 0): LogFields | undefined {
  if (fields === undefined) return undefined
  if (depth > MAX_DEPTH) return { truncated: true }
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (SECRET_KEY.test(key)) {
      out[key] = '<redacted>'
      continue
    }
    out[key] = redactValue(value, depth)
  }
  return out
}

function redactValue(value: unknown, depth: number): unknown {
  if (typeof value === 'string') return scrubString(value)
  if (Array.isArray(value)) return value.map((item) => (item !== null && typeof item === 'object' ? redactFields(item as LogFields, depth + 1) : redactValue(item, depth)))
  if (value !== null && typeof value === 'object') return redactFields(value as LogFields, depth + 1)
  return value
}