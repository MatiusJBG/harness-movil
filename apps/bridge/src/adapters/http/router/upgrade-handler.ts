import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import type { ActivationReader, ActivityMarker } from '../../../application/ports/activation-gateway.js'
import type { Logger } from '../../../application/ports/logger.js'
import type { PublicDevice } from '../../../domain/device/device.js'
import { resolveProxyTarget } from '../../../application/use-cases/resolve-proxy-target.js'
import type { BridgeProxy } from '../proxy/proxy-port.js'

export interface UpgradeHandlerOptions {
  readonly authenticate: (req: IncomingMessage) => PublicDevice | null
  readonly activation: ActivationReader & ActivityMarker
  readonly proxy: BridgeProxy
  readonly logger: Logger
}

/** Los WebSocket pasan por la misma decisión de acceso que el HTTP. */
export function createUpgradeHandler(options: UpgradeHandlerOptions) {
  const logger = options.logger.child({ component: 'router' })

  return (req: IncomingMessage, socket: Duplex, head: Buffer, admin: boolean): void => {
    const deny = (status: number, message: string): void => {
      socket.write(`HTTP/1.1 ${String(status)} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
      socket.destroy()
    }
    const device = admin ? null : options.authenticate(req)
    const decision = resolveProxyTarget({ device, admin, activation: options.activation.snapshot() })
    if (decision.kind === 'deny') {
      if (decision.reason === 'unpaired') logger.warn('upgrade rechazado: dispositivo no emparejado', { path: req.url ?? '' })
      deny(decision.reason === 'unpaired' ? 401 : 503, decision.reason === 'unpaired' ? 'Unauthorized' : 'Service Unavailable')
      return
    }
    options.activation.touch()
    options.proxy.ws(req, socket, head, decision.port)
  }
}
