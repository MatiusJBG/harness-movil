import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Logger } from '../../../application/ports/logger.js'
import type { RateLimiter } from '../../../application/ports/rate-limiter.js'
import type { PublicDevice } from '../../../domain/device/device.js'
import { requestIp, sameOriginOk, wantsJson } from '../middleware/request-meta.js'
import { applySecurityHeaders } from '../middleware/security-headers.js'
import { CSRF_HEADER, DEVICE_COOKIE, getCookie } from '../presenters/cookies.js'
import { mapError } from '../presenters/error-mapper.js'
import { redirect, sendError } from '../presenters/response.js'
import { findRoute, type RequestContext, type RouteDefinition } from './route-definition.js'

export interface RouterOptions {
  readonly routes: readonly RouteDefinition[]
  readonly authenticate: (req: IncomingMessage) => PublicDevice | null
  readonly pairingLimiter: RateLimiter
  readonly logger: Logger
}

export interface Router {
  readonly handle: (req: IncomingMessage, res: ServerResponse, admin: boolean) => Promise<void>
}

type GuardResult = { readonly ok: true } | { readonly ok: false; readonly status: number; readonly code: string; readonly message: string }

function mutationAllowed(req: IncomingMessage): boolean {
  return sameOriginOk(req) && req.headers[CSRF_HEADER] === '1'
}

function denyUnpaired(req: IncomingMessage, res: ServerResponse): void {
  if (wantsJson(req)) sendError(res, 401, 'unpaired', 'Este dispositivo no está emparejado.')
  else redirect(res, '/_hm/', 302)
}

/** Todos los guards de una ruta, en un único lugar verificable. */
function evaluateGuards(
  route: RouteDefinition,
  input: { req: IncomingMessage; admin: boolean; device: PublicDevice | null; ip: string; limiter: RateLimiter },
): GuardResult {
  if (route.access === 'admin' && !input.admin) {
    return { ok: false, status: 403, code: 'admin-only', message: 'Esta acción solo está disponible desde el panel de la PC.' }
  }
  if (route.access === 'paired' && !input.admin && input.device === null) {
    return { ok: false, status: 401, code: 'unpaired', message: 'Este dispositivo no está emparejado.' }
  }
  if (route.mutation && !mutationAllowed(input.req)) {
    return { ok: false, status: 403, code: 'csrf', message: 'Origen no permitido o falta el encabezado anti-CSRF.' }
  }
  if (route.rateLimit === 'pairing' && !input.limiter.tryConsume(input.ip)) {
    return { ok: false, status: 429, code: 'rate-limited', message: 'Demasiados intentos de emparejamiento. Esperá un minuto.' }
  }
  return { ok: true }
}

function parseUrl(req: IncomingMessage): URL | null {
  try {
    return new URL(req.url ?? '/', 'https://bridge.local')
  } catch {
    return null
  }
}

/**
 * Router HTTP: autentica, aplica los guards declarados por la ruta y despacha.
 * Los controladores no deciden códigos de error: eso lo hace `mapError`.
 */
export function createRouter(options: RouterOptions): Router {
  const logger = options.logger.child({ component: 'router' })

  const dispatch = async (ctx: RequestContext, route: RouteDefinition): Promise<void> => {
    try {
      await route.handle(ctx)
    } catch (error) {
      const mapped = mapError(error)
      if (mapped.expected) logger.warn('pedido rechazado por regla de negocio', { path: ctx.path, code: mapped.code })
      else logger.error('error no controlado atendiendo un pedido', { path: ctx.path, error: mapped.message })
      if (ctx.res.headersSent) {
        ctx.res.end()
        return
      }
      sendError(ctx.res, mapped.status, mapped.code, mapped.message)
    }
  }

  return {
    handle: async (req, res, admin): Promise<void> => {
      applySecurityHeaders(res)
      const url = parseUrl(req)
      if (url === null) {
        sendError(res, 400, 'bad-request', 'Pedido inválido.')
        return
      }
      const path = url.pathname
      const device = admin ? null : options.authenticate(req)
      const ip = requestIp(req)
      const match = findRoute(options.routes, req.method ?? 'GET', path)
      if (match === null) {
        sendError(res, 404, 'not-found', 'No encontrado.')
        return
      }
      const { route, params } = match
      const guard = evaluateGuards(route, { req, admin, device, ip, limiter: options.pairingLimiter })
      if (!guard.ok) {
        logger.warn('pedido rechazado', { path, code: guard.code, ip, admin })
        if (guard.code === 'unpaired') {
          denyUnpaired(req, res)
          return
        }
        sendError(res, guard.status, guard.code, guard.message)
        return
      }
      await dispatch({ req, res, path, search: url.searchParams, admin, device, ip, params }, route)
    },
  }
}

export function readDeviceToken(req: IncomingMessage): string | null {
  return getCookie(req, DEVICE_COOKIE)
}
