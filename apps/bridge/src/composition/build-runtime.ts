import { hostname } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createFileLogger } from '../adapters/logging/file-logger.js'
import { SystemClock } from '../adapters/security/system-clock.js'
import { ForgeTlsMaterialProvider } from '../adapters/tls/forge-tls-material-provider.js'
import { readVersionFrom } from '../adapters/version/package-version.js'
import type { Clock } from '../application/ports/clock.js'
import type { Logger, LogLevel } from '../application/ports/logger.js'
import type { AppSettings } from '../application/ports/settings.js'
import type { TlsMaterial } from '../application/ports/tls-material-provider.js'
import { normalizeSans } from '../domain/tls/certificate-name.js'

const PUBLIC_DIR = fileURLToPath(new URL('../../public/', import.meta.url))
const MANIFEST_URL = new URL('../../../../package.json', import.meta.url)
const LOG_LEVELS = new Set<string>(['debug', 'info', 'warn', 'error'])

export function logLevelFromEnv(env: NodeJS.ProcessEnv): LogLevel {
  const value = env.HARNESS_MOVIL_LOG_LEVEL
  return value !== undefined && LOG_LEVELS.has(value) ? (value as LogLevel) : 'info'
}

/** SAN del certificado: IP de LAN, host anunciado, nombre del equipo y loopback. */
export function certificateNames(settings: AppSettings, machine: string = hostname()): string[] {
  return normalizeSans([
    settings.network.lanHost,
    settings.network.publicHost,
    machine,
    `${machine}.local`,
    'localhost',
    '127.0.0.1',
    '::1',
  ])
}

export interface BuildRuntimeOptions {
  readonly settings: AppSettings
  readonly env: NodeJS.ProcessEnv
  readonly publicDir?: string
  readonly manifestUrl?: URL
}

export interface Runtime {
  readonly clock: Clock
  readonly logger: Logger
  readonly tls: TlsMaterial
  readonly version: string
  readonly publicDir: string
}

/**
 * Efectos externos del arranque (reloj, logger, TLS, versión y assets) fuera de
 * `main`: así el entry no instancia adaptadores y los tests pueden doblarlos.
 */
export async function buildRuntime(options: BuildRuntimeOptions): Promise<Runtime> {
  const clock = new SystemClock()
  const logger = createFileLogger({
    file: join(options.settings.paths.logDir, 'bridge.log'),
    level: logLevelFromEnv(options.env),
    clock,
  })
  const version = readVersionFrom(options.manifestUrl ?? MANIFEST_URL)
  const tls = await new ForgeTlsMaterialProvider({
    tlsDir: options.settings.paths.tlsDir,
    mode: options.settings.tls.mode,
    certFile: options.settings.tls.certFile,
    keyFile: options.settings.tls.keyFile,
    caFile: options.settings.tls.caFile,
    clock,
  }).ensure(certificateNames(options.settings))
  return { clock, logger, tls, version, publicDir: options.publicDir ?? PUBLIC_DIR }
}
