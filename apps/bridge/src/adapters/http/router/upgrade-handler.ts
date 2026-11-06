import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import type { ActivationReader, ActivityMarker } from '../../../application/ports/activation-gateway.js'
import type { Logger } from '../../../application/ports/logger.js'
import type { PublicDevice } from '../../../domain/device/device.js'
import { resolveProxyTarget } from '../../../application/use-cases/resolve-proxy-target.js'
import { sameOriginOk } from '../middleware/request-meta.js'
import type { BridgeProxy } from '../proxy/proxy-port.js'

export interface UpgradeHandlerOptions {
  readonly authenticate: (req: IncomingMessage) => PublicDevice | null
  readonly activation: ActivationReader & ActivityMarker
  readonly proxy: BridgeProxy
  readonly logger: Logger
}

export type UpgradeHandler = (req: IncomingMessage, socket: Duplex, head: Buffer, admin: boolean) => void

/** Respuesta HTTP cruda sobre el socket del upgrade; nunca lanza. */
export function denyUpgrade(socket: Duplex, status: number, reason: string): void {
  try {
    socket.write(`HTTP/1.1 ${String(status)} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
  } catch {
    // El socket ya se cerró: no hay nada que responder.
  }
  socket.destroy()
}

/** Los WebSocket pasan por la misma decisión de acceso que el HTTP. */
export function createUpgradeHandler(options: UpgradeHandlerOptions): UpgradeHandler {
  const logger = options.logger.child({ component: 'router' })

  return (req, socket, head, admin): void => {
    try {
      if (!sameOriginOk(req)) {
        logger.warn('upgrade rechazado: origen cruzado', { path: req.url ?? '' })
        denyUpgrade(socket, 403, 'Forbidden')
        return
      }
      const device = admin ? null : options.authenticate(req)
      const decision = resolveProxyTarget({ device, admin, activation: options.activation.snapshot() })
      if (decision.kind === 'deny') {
        if (decision.reason === 'unpaired') logger.warn('upgrade rechazado: dispositivo no emparejado', { path: req.url ?? '' })
        denyUpgrade(socket, decision.reason === 'unpaired' ? 401 : 503, decision.reason === 'unpaired' ? 'Unauthorized' : 'Service Unavailable')
        return
      }
      options.activation.touch()
      options.proxy.ws(req, socket, head, decision.port)
    } catch (error) {
      logger.error('error atendiendo el upgrade', {
        path: req.url ?? '',
        error: error instanceof Error ? error.message : String(error),
      })
      denyUpgrade(socket, 400, 'Bad Request')
    }
  }
}
