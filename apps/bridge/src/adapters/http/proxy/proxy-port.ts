import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'

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
  readonly logger: LoggerLike
  /** Raíz pública del puente, para reescribir redirecciones absolutas. */
  readonly publicUrl: string
  readonly cookie: () => string | undefined
}

export interface LoggerLike {
  warn(message: string, fields?: Readonly<Record<string, unknown>>): void
  child(bindings: Readonly<Record<string, unknown>>): LoggerLike
}
