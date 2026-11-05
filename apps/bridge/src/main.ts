#!/usr/bin/env node
import { hostname } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import QRCode from 'qrcode'
import { listen } from './adapters/http/server/listen.js'
import { createFileLogger } from './adapters/logging/file-logger.js'
import { SystemClock } from './adapters/security/system-clock.js'
import { ForgeTlsMaterialProvider } from './adapters/tls/forge-tls-material-provider.js'
import { readVersionFrom } from './adapters/version/package-version.js'
import type { LogLevel } from './application/ports/logger.js'
import type { AppSettings } from './application/ports/settings.js'
import { parseArgs } from './cli/args.js'
import { printHelp } from './cli/help.js'
import { buildApplication } from './composition/build-application.js'
import { buildServers } from './composition/build-servers.js'
import { describeSettings, loadSettings } from './config/loader.js'
import { normalizeSans } from './domain/tls/certificate-name.js'

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url))
const MANIFEST_URL = new URL('../../../package.json', import.meta.url)
const LOG_LEVELS = new Set<string>(['debug', 'info', 'warn', 'error'])

function logLevelFromEnv(env: NodeJS.ProcessEnv): LogLevel {
  const value = env.HARNESS_MOVIL_LOG_LEVEL
  return value !== undefined && LOG_LEVELS.has(value) ? (value as LogLevel) : 'info'
}

/** SAN del certificado: IP de LAN, host anunciado, nombre del equipo y loopback. */
function certificateNames(settings: AppSettings): string[] {
  const machine = hostname()
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
    return
  }

  const clock = new SystemClock()
  const loaded = await loadSettings({ dataDir: args.dataDir, readOnly: args.checkConfig })
  if (args.checkConfig) {
    console.log(JSON.stringify(describeSettings(loaded), null, 2))
    return
  }

  const { settings } = loaded
  const logger = createFileLogger({
    file: join(settings.paths.logDir, 'bridge.log'),
    level: logLevelFromEnv(process.env),
    clock,
  })
  if (loaded.migrated) {
    logger.info('configuración migrada a schemaVersion 2', { backupFile: loaded.backupFile })
  }

  const version = readVersionFrom(MANIFEST_URL)
  const tls = await new ForgeTlsMaterialProvider({
    tlsDir: settings.paths.tlsDir,
    mode: settings.tls.mode,
    certFile: settings.tls.certFile,
    keyFile: settings.tls.keyFile,
    caFile: settings.tls.caFile,
    clock,
  }).ensure(certificateNames(settings))

  const app = await buildApplication({ settings, logger, clock, tls, version, publicDir: PUBLIC_DIR })
  const servers = buildServers({ settings, router: app.router, upgrade: app.upgrade, tls, logger })

  await listen(servers.lan, settings.network.port, settings.network.bindHost)
  await listen(servers.admin, settings.network.adminPort, settings.network.adminHost)

  const ticket = app.pairingTicket()
  const pairUrl = `${settings.network.publicUrl}_hm/#p=${ticket.secret}`
  const caUrl = `${settings.network.adminUrl}ca.cer`
  const caLanUrl = `${settings.network.publicUrl}_hm/ca.cer`

  logger.info('puente listo', {
    lan: settings.network.publicUrl,
    admin: settings.network.adminUrl,
    devices: app.devices.activeCount(),
    version,
  })

  console.log('')
  console.log('  Harness Móvil — puente listo')
  console.log('  ────────────────────────────────────────────────')
  console.log(`  Panel en la PC : ${settings.network.adminUrl}`)
  console.log(`  Panel en el tel: https://${settings.network.authority}/_hm/`)
  console.log(`  CA (PC)        : ${caUrl}`)
  console.log(`  CA (teléfono)  : ${caLanUrl}`)
  console.log(
    `  Código         : ${ticket.code}  (vence en ${String(Math.round(settings.pairing.ticketTtlSeconds / 60))} min)`,
  )
  console.log(`  Emparejar      : ${pairUrl}`)
  console.log('')
  try {
    const qr = await QRCode.toString(pairUrl, { type: 'terminal', small: true })
    console.log(qr)
  } catch {
    // Terminal sin soporte de QR: la URL alcanza.
  }
  console.log('')

  if (settings.activation.autoStart) {
    void app.activation.activate().catch(() => undefined)
  }

  let shuttingDown = false
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    logger.info('cerrando el puente', { signal })
    await servers.close()
    await app.dispose().catch(() => undefined)
    await logger.close()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('unhandledRejection', (reason) => {
    logger.error('promesa rechazada sin manejar', {
      error: reason instanceof Error ? reason.message : String(reason),
    })
  })
}

main().catch((error: unknown) => {
  console.error(`Harness Móvil no pudo arrancar: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
