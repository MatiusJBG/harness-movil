import { createServer as createHttpServer, type Server } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Logger } from '../../../application/ports/logger.js'
import type { Router } from '../router/router.js'
import type { UpgradeHandler } from './lan-server.js'
import { sendError } from '../presenters/response.js'

export interface AdminServerOptions {
  readonly router: Router
  readonly upgrade: UpgradeHandler
  readonly logger: Logger
}

/** Listener de administración: HTTP y solo loopback (no usa la CA). */
export function createAdminServer(options: AdminServerOptions): Server {
  const handler = (req: IncomingMessage, res: ServerResponse): void => {
    options.router.handle(req, res, true).catch((error: unknown) => {
      options.logger.error('error no controlado atendiendo un pedido de administración', {
        error: error instanceof Error ? error.message : String(error),
      })
      if (!res.headersSent) sendError(res, 500, 'internal-error', 'Error interno del puente.')
      else res.end()
    })
  }
  const server = createHttpServer(handler)
  server.on('upgrade', (req, socket, head) => {
    options.upgrade(req, socket, head, true)
  })
  return server
}
