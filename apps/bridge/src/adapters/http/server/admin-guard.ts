import type { IncomingMessage } from 'node:http'
import { isLoopbackRequest } from '../middleware/request-meta.js'

const LOOPBACK_HOSTS: readonly string[] = ['127.0.0.1', 'localhost', '[::1]']

/** Hosts válidos para el panel: el puerto real del listener, en loopback literal. */
export function adminHostsAllowed(host: string | undefined, port: number | undefined): boolean {
  if (host === undefined || host === '') return false
  if (port === undefined) return false
  const normalized = host.toLowerCase()
  if (port === 80 && LOOPBACK_HOSTS.includes(normalized)) return true
  return LOOPBACK_HOSTS.some((allowed) => normalized === `${allowed}:${String(port)}`)
}

/**
 * Defensa en profundidad del listener admin: además del bind loopback, exige
 * que el pedido venga de loopback y que el `Host` sea el del propio panel
 * (bloquea DNS rebinding).
 */
export function isAdminRequest(req: IncomingMessage): boolean {
  return isLoopbackRequest(req) && adminHostsAllowed(req.headers.host, req.socket.localPort)
}
