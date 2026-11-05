import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import type { Activation } from './activation.js'
import { DEVICE_COOKIE, getCookie, redirect, requestIp, sendJson, wantsJson } from './auth.js'
import type { ResolvedConfig } from './config.js'
import type { Dashboard } from './dashboard.js'
import type { DeviceStore, PublicDevice } from './devices.js'
import type { Logger } from './log.js'
import type { BridgeProxy } from './proxy.js'

export interface RouterOptions {
  config: ResolvedConfig
  devices: DeviceStore
  activation: Activation
  proxy: BridgeProxy
  dashboard: Dashboard
  logger: Logger
}

export interface Router {
  handle(req: IncomingMessage, res: ServerResponse, admin: boolean): Promise<void>
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, admin: boolean): void
  authenticate(req: IncomingMessage, admin: boolean): PublicDevice | null
}

export function createRouter(options: RouterOptions): Router {
  const logger = options.logger.child({ component: 'router' })

  const authenticate = (req: IncomingMessage, admin: boolean): PublicDevice | null => {
    if (admin) return null
    return options.devices.authenticate(getCookie(req, DEVICE_COOKIE), requestIp(req))
  }

  const authorized = (req: IncomingMessage, admin: boolean): boolean => admin || authenticate(req, admin) !== null

  const handle = async (req: IncomingMessage, res: ServerResponse, admin: boolean): Promise<void> => {
    const path = new URL(req.url ?? '/', 'https://bridge.local').pathname

    if (path === '/_hm') {
      redirect(res, '/_hm/', 302)
      return
    }
    if (path.startsWith('/_hm/')) {
      await options.dashboard.handle(req, res, admin)
      return
    }

    if (!authorized(req, admin)) {
      logger.warn('pedido rechazado: dispositivo no emparejado', {
        path,
        ip: requestIp(req),
        admin,
      })
      if (wantsJson(req)) sendJson(res, 401, { error: 'Este dispositivo no está emparejado.' })
      else redirect(res, '/_hm/', 302)
      return
    }

    if (!options.activation.isActive()) {
      if (wantsJson(req)) sendJson(res, 503, { error: 'La conexión con Harness está desactivada.' })
      else redirect(res, '/_hm/?inactive=1', 302)
      return
    }

    const port = options.activation.snapshot().port
    if (!port) {
      if (wantsJson(req)) sendJson(res, 503, { error: 'El host Harness todavía no está listo.' })
      else redirect(res, '/_hm/', 302)
      return
    }

    options.activation.touch()
    options.proxy.web(req, res, port)
  }

  const handleUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer, admin: boolean): void => {
    const deny = (status: number, message: string): void => {
      socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
      socket.destroy()
    }
    if (!authorized(req, admin)) {
      deny(401, 'Unauthorized')
      return
    }
    if (!options.activation.isActive()) {
      deny(503, 'Service Unavailable')
      return
    }
    const port = options.activation.snapshot().port
    if (!port) {
      deny(503, 'Service Unavailable')
      return
    }
    options.activation.touch()
    options.proxy.ws(req, socket, head, port)
  }

  return { handle, handleUpgrade, authenticate }
}
