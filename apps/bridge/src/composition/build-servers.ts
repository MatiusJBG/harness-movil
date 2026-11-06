import type { Server } from 'node:http'
import type { Logger } from '../application/ports/logger.js'
import type { AppSettings } from '../application/ports/settings.js'
import type { TlsMaterial } from '../application/ports/tls-material-provider.js'
import { closeServer, listen } from '../adapters/http/server/listen.js'
import { createAdminServer } from '../adapters/http/server/admin-server.js'
import { createLanServer } from '../adapters/http/server/lan-server.js'
import type { Router } from '../adapters/http/router/router.js'
import type { UpgradeHandler } from '../adapters/http/server/lan-server.js'

export interface BuildServersOptions {
  readonly settings: AppSettings
  readonly router: Router
  readonly upgrade: UpgradeHandler
  readonly tls: TlsMaterial
  readonly logger: Logger
}

export interface BuiltServers {
  readonly lan: Server
  readonly admin: Server
  /** Bindea ambos listeners (LAN y admin) con la configuración resuelta. */
  listen(): Promise<void>
  close(): Promise<void>
}

export function buildServers(options: BuildServersOptions): BuiltServers {
  const lan = createLanServer({ tls: options.tls, router: options.router, upgrade: options.upgrade, logger: options.logger })
  const admin = createAdminServer({ router: options.router, upgrade: options.upgrade, logger: options.logger })
  return {
    lan,
    admin,
    async listen(): Promise<void> {
      await listen(lan, options.settings.network.port, options.settings.network.bindHost)
      await listen(admin, options.settings.network.adminPort, options.settings.network.adminHost)
    },
    async close(): Promise<void> {
      await Promise.allSettled([closeServer(lan), closeServer(admin)])
    },
  }
}
