import { ConfigError } from './errors.js'

const LEGACY_KEYS = new Set(['listen', 'dsh', 'tls', 'pairing', 'activation', 'limits', 'publicHost'])

/** ¿El archivo es un config v1 (sin `schemaVersion` y con claves del formato viejo)? */
export function isLegacyV1(raw: unknown): raw is Record<string, unknown> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return false
  const record = raw as Record<string, unknown>
  if ('schemaVersion' in record) return false
  return Object.keys(record).some((key) => LEGACY_KEYS.has(key))
}

/**
 * Traduce v1 → v2. No valida tipos (eso lo hace el esquema v2): solo reubica
 * claves, de modo que un valor inválido siga señalando la ruta exacta.
 */
export function migrateLegacyV1(raw: Record<string, unknown>): Record<string, unknown> {
  assertKnownKeys(raw)
  const listen = asRecord(raw.listen, 'listen')
  const dsh = asRecord(raw.dsh, 'dsh')
  const pairing = asRecord(raw.pairing, 'pairing')
  return {
    schemaVersion: 2,
    server: migrateServer(listen, raw.publicHost),
    harness: migrateHarness(dsh),
    tls: raw.tls ?? {},
    pairing: migratePairing(pairing),
    activation: raw.activation ?? {},
    limits: raw.limits ?? {},
  }
}

function assertKnownKeys(raw: Record<string, unknown>): void {
  const unknown = Object.keys(raw).filter((key) => !LEGACY_KEYS.has(key))
  if (unknown.length === 0) return
  throw new ConfigError(
    `config.json v1 tiene claves desconocidas: ${unknown.join(', ')}. Revisá el formato en el README.`,
    'config-unknown-keys',
  )
}

function migrateServer(listen: Record<string, unknown>, publicHost: unknown): Record<string, unknown> {
  return {
    lan: { host: listen.host ?? 'auto', port: listen.port ?? 8443 },
    admin: { host: '127.0.0.1', port: listen.adminPort ?? null },
    publicHost: publicHost ?? null,
  }
}

function migrateHarness(dsh: Record<string, unknown>): Record<string, unknown> {
  return {
    command: dsh.command ?? 'auto',
    profile: dsh.profile ?? 'mobile',
    home: dsh.home ?? null,
    sessions: dsh.sessions ?? 'isolated',
    extraArgs: dsh.extraArgs ?? [],
    startTimeoutMs: dsh.startTimeoutMs ?? 90_000,
  }
}

function migratePairing(pairing: Record<string, unknown>): Record<string, unknown> {
  return {
    ticketTtlSeconds: pairing.codeTtlSeconds ?? 300,
    maxDevices: pairing.maxDevices ?? 3,
  }
}

function asRecord(value: unknown, key: string): Record<string, unknown> {
  if (value === undefined) return {}
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConfigError(`config.json v1: "${key}" debe ser un objeto.`, 'config-invalid')
  }
  return value as Record<string, unknown>
}
