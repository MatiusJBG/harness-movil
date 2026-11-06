#!/usr/bin/env node
import { parseArgs } from './cli/args.js'
import { printHelp } from './cli/help.js'
import { buildApplication } from './composition/build-application.js'
import { buildRuntime } from './composition/build-runtime.js'
import { buildServers } from './composition/build-servers.js'
import { printStartupBanner } from './composition/startup-banner.js'
import { describeSettings, loadSettings } from './config/loader.js'

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
    return
  }

  const loaded = await loadSettings({ dataDir: args.dataDir, readOnly: args.checkConfig })
  if (args.checkConfig) {
    console.log(JSON.stringify(describeSettings(loaded), null, 2))
    return
  }

  const { settings } = loaded
  const runtime = await buildRuntime({ settings, env: process.env })
  if (loaded.migrated) {
    runtime.logger.info('configuración migrada a schemaVersion 2', { backupFile: loaded.backupFile })
  }

  const app = await buildApplication({
    settings,
    logger: runtime.logger,
    clock: runtime.clock,
    tls: runtime.tls,
    version: runtime.version,
    publicDir: runtime.publicDir,
  })
  const servers = buildServers({
    settings,
    router: app.router,
    upgrade: app.upgrade,
    tls: runtime.tls,
    logger: runtime.logger,
  })
  await servers.listen()

  const ticket = app.pairingTicket()
  runtime.logger.info('puente listo', {
    lan: settings.network.publicUrl,
    admin: settings.network.adminUrl,
    devices: app.devices.activeCount(),
    version: runtime.version,
  })
  await printStartupBanner({ settings, ticket, version: runtime.version })

  if (settings.activation.autoStart) {
    void app.activation.activate().catch(() => undefined)
  }

  let shuttingDown = false
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    runtime.logger.info('cerrando el puente', { signal })
    await servers.close()
    await app.dispose().catch(() => undefined)
    await runtime.logger.close()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('unhandledRejection', (reason) => {
    runtime.logger.error('promesa rechazada sin manejar', {
      error: reason instanceof Error ? reason.message : String(reason),
    })
  })
}

main().catch((error: unknown) => {
  console.error(`Harness Móvil no pudo arrancar: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
