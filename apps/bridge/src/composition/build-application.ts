import type { IncomingMessage } from 'node:http'
import { join } from 'node:path'
import type { Clock } from '../application/ports/clock.js'
import type { Logger } from '../application/ports/logger.js'
import type { AppSettings } from '../application/ports/settings.js'
import type { TlsMaterial } from '../application/ports/tls-material-provider.js'
import { authenticateRequest } from '../application/use-cases/authenticate-request.js'
import { pairDevice } from '../application/use-cases/pair-device.js'
import { revokeDevice } from '../application/use-cases/revoke-device.js'
import { signOutDevice } from '../application/use-cases/sign-out-device.js'
import { readPairingTicket, refreshPairingTicket } from '../application/use-cases/issue-pairing-ticket.js'
import { Activation } from '../application/use-cases/activation.js'
import type { PublicDevice } from '../domain/device/device.js'
import { sessionsRootName } from '../domain/harness/session-scope.js'
import type { PairingTicket } from '../domain/pairing/pairing-ticket.js'
import { HttpSessionCookieStore } from '../adapters/harness/http-session-cookie-store.js'
import { DshProcessSupervisor } from '../adapters/harness/process-supervisor.js'
import { createActivationController } from '../adapters/http/controllers/activation-controller.js'
import { createAssetsController } from '../adapters/http/controllers/assets-controller.js'
import { createCaController } from '../adapters/http/controllers/ca-controller.js'
import { createDevicesController } from '../adapters/http/controllers/devices-controller.js'
import { createDiagnosticsController } from '../adapters/http/controllers/diagnostics-controller.js'
import { createPairingController } from '../adapters/http/controllers/pairing-controller.js'
import { createProxyController } from '../adapters/http/controllers/proxy-controller.js'
import { createSessionController } from '../adapters/http/controllers/session-controller.js'
import { createStatusController } from '../adapters/http/controllers/status-controller.js'
import { requestIp } from '../adapters/http/middleware/request-meta.js'
import { createHttpProxy } from '../adapters/http/proxy/http-proxy-adapter.js'
import type { BridgeProxy } from '../adapters/http/proxy/proxy-port.js'
import { createRouteTable, type RouteControllers } from '../adapters/http/router/route-table.js'
import { createRouter, readDeviceToken, type Router } from '../adapters/http/router/router.js'
import { createUpgradeHandler } from '../adapters/http/router/upgrade-handler.js'
import type { UpgradeHandler } from '../adapters/http/server/lan-server.js'
import { PublicAssetManifest, type AssetSource } from '../adapters/http/static/asset-manifest.js'
import { InMemoryPairingTicketStore } from '../adapters/pairing/in-memory-pairing-ticket-store.js'
import { JsonDeviceRepository } from '../adapters/persistence/json-device-repository.js'
import { CryptoIdGenerator } from '../adapters/security/crypto-id-generator.js'
import { MemoryRateLimiter } from '../adapters/security/memory-rate-limiter.js'
import { Sha256SecretHasher } from '../adapters/security/sha256-secret-hasher.js'

export interface BuildApplicationOptions {
  readonly settings: AppSettings
  readonly logger: Logger
  readonly clock: Clock
  readonly tls: TlsMaterial
  readonly version: string
  readonly publicDir: string
  readonly env?: NodeJS.ProcessEnv
}

export interface BuiltApplication {
  readonly activation: Activation
  readonly devices: JsonDeviceRepository
  readonly router: Router
  readonly upgrade: UpgradeHandler
  readonly proxy: BridgeProxy
  readonly pairingTicket: () => PairingTicket
  dispose(): Promise<void>
}

interface CoreStack {
  readonly devices: JsonDeviceRepository
  readonly hasher: Sha256SecretHasher
  readonly ids: CryptoIdGenerator
  readonly tickets: InMemoryPairingTicketStore
  readonly cookies: HttpSessionCookieStore
  readonly activation: Activation
  readonly proxy: BridgeProxy
  readonly limiter: MemoryRateLimiter
}

async function buildCore(options: BuildApplicationOptions): Promise<CoreStack> {
  const { settings, logger, clock } = options
  const devices = new JsonDeviceRepository({ file: settings.paths.devicesFile, clock })
  await devices.load()
  const ids = new CryptoIdGenerator()
  const tickets = new InMemoryPairingTicketStore(ids)
  const supervisor = new DshProcessSupervisor({
    settings: settings.harness,
    dataDir: settings.paths.dataDir,
    dshHome: settings.paths.dshHome,
    publicUrl: settings.network.publicUrl,
    logger,
    deps: options.env === undefined ? undefined : { env: options.env },
  })
  const cookies = new HttpSessionCookieStore()
  const activation = new Activation({
    supervisor,
    cookies,
    logger,
    clock,
    idleAutoOffMinutes: settings.activation.idleAutoOffMinutes,
  })
  const proxy = createHttpProxy({ logger, publicUrl: settings.network.publicUrl, cookie: () => cookies.header() })
  return {
    devices,
    hasher: new Sha256SecretHasher(),
    ids,
    tickets,
    cookies,
    activation,
    proxy,
    limiter: new MemoryRateLimiter(settings.limits.pairingPerMinute, 60_000, clock),
  }
}

interface ControllersInput {
  readonly core: CoreStack
  readonly settings: AppSettings
  readonly clock: Clock
  readonly tls: TlsMaterial
  readonly version: string
  readonly sessionsRoot: string
  readonly assets: AssetSource
  readonly logger: Logger
}

function buildControllers(input: ControllersInput): RouteControllers {
  const { core, settings, clock, tls, logger } = input
  const pairingDeps = { tickets: core.tickets, clock, ttlSeconds: settings.pairing.ticketTtlSeconds }
  return {
    session: createSessionController({
      activation: core.activation,
      signOut: (body) => signOutDevice({ devices: core.devices, clock }, body),
    }),
    pairing: createPairingController({
      pair: (body) => pairDevice({ tickets: core.tickets, devices: core.devices, hasher: core.hasher, ids: core.ids, clock }, body),
      readTicket: () => readPairingTicket(pairingDeps),
      refreshTicket: () => refreshPairingTicket(pairingDeps),
      publicUrl: settings.network.publicUrl,
      maxBodyBytes: settings.limits.maxBodyBytes,
      maxDevices: settings.pairing.maxDevices,
      limiter: core.limiter,
      logger,
    }),
    devices: createDevicesController({
      devices: core.devices,
      revoke: (body) => revokeDevice({ devices: core.devices, clock }, body),
      logger,
    }),
    activation: createActivationController({ activation: core.activation, logger }),
    status: createStatusController({
      activation: core.activation,
      devices: core.devices,
      network: settings.network,
      harness: settings.harness,
      paths: settings.paths,
      sessionsRoot: input.sessionsRoot,
      tls,
      version: input.version,
      clock,
    }),
    diagnostics: createDiagnosticsController({
      version: input.version,
      runtime: { node: process.version, platform: `${process.platform}-${process.arch}` },
      paths: settings.paths,
      harness: settings.harness,
      network: settings.network,
      tls,
    }),
    ca: createCaController({ tls }),
    assets: createAssetsController({ assets: input.assets }),
    proxy: createProxyController({ proxy: core.proxy, activation: core.activation }),
  }
}

/**
 * Raíz de composición: el ÚNICO lugar que conoce implementaciones concretas.
 * Los casos de uso reciben puertos; los adaptadores, configuración.
 */
export async function buildApplication(options: BuildApplicationOptions): Promise<BuiltApplication> {
  const { settings, logger, clock, tls } = options
  const core = await buildCore(options)
  const assets = await PublicAssetManifest.load(options.publicDir)
  const sessionsRoot = join(settings.paths.dshHome, sessionsRootName(settings.harness.sessions))
  const controllers = buildControllers({
    core,
    settings,
    clock,
    tls,
    version: options.version,
    sessionsRoot,
    assets,
    logger,
  })
  const authenticate = (req: IncomingMessage): PublicDevice | null =>
    authenticateRequest({ devices: core.devices, hasher: core.hasher, clock }, { token: readDeviceToken(req), ip: requestIp(req) })
  const router = createRouter({
    routes: createRouteTable(controllers),
    authenticate,
    pairingLimiter: core.limiter,
    logger,
  })
  const upgrade = createUpgradeHandler({ authenticate, activation: core.activation, proxy: core.proxy, logger })
  const pairingDeps = { tickets: core.tickets, clock, ttlSeconds: settings.pairing.ticketTtlSeconds }

  return {
    activation: core.activation,
    devices: core.devices,
    router,
    upgrade,
    proxy: core.proxy,
    pairingTicket: () => readPairingTicket(pairingDeps),
    async dispose(): Promise<void> {
      core.proxy.close()
      await core.activation.dispose()
    },
  }
}
