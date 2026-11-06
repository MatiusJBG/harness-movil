import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import type { Logger } from '../../../application/ports/logger.js'

/**
 * Puerto del proxy HTTP/WS. Vive en el adaptador HTTP (y no en aplicación)
 * porque habla directamente el protocolo de Node.
 */
export interface BridgeProxy {
  /** Devuelve false cuando no hay puerto de upstream utilizable. */
  web(req: IncomingMessage, res: ServerResponse, port: number): boolean
  ws(req: IncomingMessage, socket: Duplex, head: Buffer, port: number): boolean
  close(): void
}

export interface BridgeProxyOptions {
  readonly logger: Logger
  /** Raíz pública del puente, para reescribir redirecciones absolutas. */
  readonly publicUrl: string
  readonly cookie: () => string | undefined
}
