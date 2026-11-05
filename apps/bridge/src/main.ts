#!/usr/bin/env node
import { createServer as createHttpServer, type Server } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import QRCode from 'qrcode'
import { Activation } from './activation.js'
import { loadConfig } from './config.js'
import { DeviceStore } from './devices.js'
import { DshSupervisor } from './dsh.js'
import { createDashboard } from './dashboard.js'
import { createRouter } from './http.js'
import { DshJar } from './jar.js'
import { createLogger } from './log.js'
import { PairingService } from './pairing.js'
import { createBridgeProxy } from './proxy.js'
import { ensureTls, normalizeSans } from './tls.js'
import { readVersion } from './version.js'

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url))

interface CliArgs {
  dataDir?: string
  help: boolean
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--data-dir') {
      const value = argv[index + 1]
      if (!value) throw new Error('--data-dir requiere una ruta')
      args.dataDir = value
      index += 1
    } else if (arg === '--help' || arg === '-h') {
      args.help = true
    } else {
      throw new Error(`Argumento desconocido: ${arg}`)
    }
  }
  return args
}

function printHelp(): void {
  console.log(`Harness Móvil — puente PC-telefono para DeepSeek Harness

Uso:
  npm start [-- --data-dir <ruta>]

Variables:
  HARNESS_MOVIL_DATA_DIR   carpeta de datos (default: %LOCALAPPDATA%\\harness-movil)
  HARNESS_MOVIL_LOG_LEVEL  debug | info | warn | error (default: info)

La configuración vive en <data-dir>/config.json.`);
}

async function listen(server: Server, port: number, host: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off('listening', onListening)
      if (error.code === 'EADDRINUSE') {
        reject(new Error(`El puerto ${port} ya está en uso. Cambialo en config.json y volvé a intentar.`))
        return
      }
      if (error.code === 'EACCES') {
        reject(new Error(`No hay permiso para escuchar en ${host}:${port}.`))
        return
      }
      reject(error)
    }
    const onListening = () => {
      server.off('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, host)
  })
}

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections?.()
  await new Promise<void>((resolve) => server.close(() => resolve()))
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
    return
  }

  const config = await loadConfig({ dataDir: args.dataDir })
  const logger = createLogger({
    file: join(config.logDir, 'bridge.log'),
    level: (process.env.HARNESS_MOVIL_LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error' | undefined) ?? 'info',
  })
  const version = readVersion()

  const sans = normalizeSans([
    config.lanHost,
    config.publicHost,
    hostname(),
    `${hostname()}.local`,
    'localhost',
    '127.0.0.1',
    '::1',
  ])
  const tls = await ensureTls({
    tlsDir: config.tlsDir,
    mode: config.config.tls.mode,
    certFile: config.config.tls.certFile,
    keyFile: config.config.tls.keyFile,
    caFile: config.config.tls.caFile,
    sans,
  })

  const devices = new DeviceStore(config.devicesFile)
  await devices.load()

  const pairing = new PairingService()
  const initialTicket = pairing.issue(config.config.pairing.codeTtlSeconds * 1_000)

  const supervisor = new DshSupervisor({ config, logger })
  const jar = new DshJar()
  const activation = new Activation({
    supervisor,
    jar,
    logger,
    idleAutoOffMinutes: config.config.activation.idleAutoOffMinutes,
  })

  const proxy = createBridgeProxy({
    logger,
    publicUrl: config.publicUrl,
    cookie: () => jar.header(),
  })

  const dashboard = await createDashboard({
    config,
    devices,
    pairing,
    activation,
    tls,
    logger,
    publicDir: PUBLIC_DIR,
    version,
  })

  const router = createRouter({ config, devices, activation, proxy, dashboard, logger })

  const handleRequest = (admin: boolean) => (req: Parameters<typeof router.handle>[0], res: Parameters<typeof router.handle>[1]) => {
    router.handle(req, res, admin).catch((error: unknown) => {
      logger.error('error no controlado atendiendo un pedido', {
        error: error instanceof Error ? error.message : String(error),
      })
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('Error interno del puente.')
      } else {
        res.end()
      }
    })
  }

  const lanServer = createHttpsServer(
    { cert: tls.certPem, key: tls.keyPem, minVersion: 'TLSv1.2' },
    handleRequest(false),
  )
  lanServer.on('upgrade', (req, socket, head) => router.handleUpgrade(req, socket, head, false))
  lanServer.on('tlsClientError', () => {
    // Browsers probe TLS with invalid names; a failed handshake is not an error.
  })

  const adminServer = createHttpServer(handleRequest(true))
  adminServer.on('upgrade', (req, socket, head) => router.handleUpgrade(req, socket, head, true))

  await listen(lanServer, config.port, config.bindHost)
  await listen(adminServer, config.adminPort, '127.0.0.1')

  const pairUrl = `${config.publicUrl}_hm/#p=${initialTicket.secret}`
  const caUrl = `${config.adminUrl}ca.cer`
  const caLanUrl = `${config.publicUrl}_hm/ca.cer`

  logger.info('puente listo', {
    lan: config.publicUrl,
    admin: config.adminUrl,
    devices: devices.activeCount(),
    version,
  })

  console.log('')
  console.log('  Harness Móvil — puente listo')
  console.log('  ────────────────────────────────────────────────')
  console.log(`  Panel en la PC : ${config.adminUrl}`)
  console.log(`  Panel en el tel: https://${config.authority}/_hm/`)
  console.log(`  CA (PC)        : ${caUrl}`)
  console.log(`  CA (teléfono)  : ${caLanUrl}`)
  console.log(`  Código         : ${initialTicket.code}  (vence en ${Math.round(config.config.pairing.codeTtlSeconds / 60)} min)`)
  console.log(`  Emparejar      : ${pairUrl}`)
  console.log('')
  try {
    const qr = await QRCode.toString(pairUrl, { type: 'terminal', small: true })
    console.log(qr)
  } catch {
    // Terminal without QR support; the URL above is enough.
  }
  console.log('')

  if (config.config.activation.autoStart) {
    void activation.activate().catch(() => undefined)
  }

  let shuttingDown = false
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    logger.info('cerrando el puente', { signal })
    await Promise.allSettled([closeServer(lanServer), closeServer(adminServer)])
    proxy.close()
    await activation.dispose().catch(() => undefined)
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
