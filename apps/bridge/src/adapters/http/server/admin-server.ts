import { createServer as createHttpServer, type Server } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Logger } from '../../../application/ports/logger.js'
import type { Router } from '../router/router.js'
import { denyUpgrade, type UpgradeHandler } from '../router/upgrade-handler.js'
import { sendError } from '../presenters/response.js'
import { isAdminRequest } from './admin-guard.js'

export interface AdminServerOptions {
  readonly router: Router
  readonly upgrade: UpgradeHandler
  readonly logger: Logger
}

/** Listener de administración: HTTP, solo loopback y con Host allowlist. */
export function createAdminServer(options: AdminServerOptions): Server {
  const handler = (req: IncomingMessage, res: ServerResponse): void => {
    if (!isAdminRequest(req)) {
      options.logger.warn('pedido rechazado por el guard del panel', { host: req.headers.host ?? '' })
      sendError(res, 403, 'admin-forbidden', 'El panel solo se atiende en loopback y con un Host válido.')
      return
    }
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
    if (!isAdminRequest(req)) {
      denyUpgrade(socket, 403, 'Forbidden')
      return
    }
    try {
      options.upgrade(req, socket, head, true)
    } catch (error) {
      options.logger.error('error atendiendo el upgrade del panel', {
        error: error instanceof Error ? error.message : String(error),
      })
      denyUpgrade(socket, 400, 'Bad Request')
    }
  })
  return server
}
