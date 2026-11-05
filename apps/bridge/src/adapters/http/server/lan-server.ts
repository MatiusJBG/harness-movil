import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import type { Duplex } from 'node:stream'
import type { Logger } from '../../../application/ports/logger.js'
import type { TlsMaterial } from '../../../application/ports/tls-material-provider.js'
import type { Router } from '../router/router.js'
import { sendError } from '../presenters/response.js'

export type UpgradeHandler = (req: IncomingMessage, socket: Duplex, head: Buffer, admin: boolean) => void

export interface LanServerOptions {
  readonly tls: TlsMaterial
  readonly router: Router
  readonly upgrade: UpgradeHandler
  readonly logger: Logger
}

/** Listener LAN: solo HTTPS (TLS 1.2+) y el proxy raíz. */
export function createLanServer(options: LanServerOptions): Server {
  const handler = (req: IncomingMessage, res: ServerResponse): void => {
    options.router.handle(req, res, false).catch((error: unknown) => {
      options.logger.error('error no controlado atendiendo un pedido', {
        error: error instanceof Error ? error.message : String(error),
      })
      if (!res.headersSent) sendError(res, 500, 'internal-error', 'Error interno del puente.')
      else res.end()
    })
  }
  const server = createHttpsServer({ cert: options.tls.certPem, key: options.tls.keyPem, minVersion: 'TLSv1.2' }, handler)
  server.on('upgrade', (req, socket, head) => {
    options.upgrade(req, socket, head, false)
  })
  server.on('tlsClientError', () => {
    // Los navegadores prueban TLS con nombres inválidos: un handshake fallido no es un error.
  })
  return server
}
