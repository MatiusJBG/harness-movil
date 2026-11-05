import type { ActivationReader, ActivityMarker } from '../../../application/ports/activation-gateway.js'
import { resolveProxyTarget } from '../../../application/use-cases/resolve-proxy-target.js'
import { wantsJson } from '../middleware/request-meta.js'
import { redirect, sendError } from '../presenters/response.js'
import type { BridgeProxy } from '../proxy/proxy-port.js'
import type { RequestContext } from '../router/route-definition.js'

export interface ProxyControllerOptions {
  readonly proxy: BridgeProxy
  readonly activation: ActivationReader & ActivityMarker
}

export interface ProxyController {
  readonly handle: (ctx: RequestContext) => void
}

export function createProxyController(options: ProxyControllerOptions): ProxyController {
  return {
    handle: (ctx): void => {
      const decision = resolveProxyTarget({
        device: ctx.device,
        admin: ctx.admin,
        activation: options.activation.snapshot(),
      })
      if (decision.kind === 'deny') {
        denyProxy(ctx, decision.reason)
        return
      }
      options.activation.touch()
      if (!options.proxy.web(ctx.req, ctx.res, decision.port)) {
        sendError(ctx.res, 503, 'harness-unavailable', 'El host Harness todavía no está listo.')
      }
    },
  }
}

function denyProxy(ctx: RequestContext, reason: 'unpaired' | 'inactive' | 'starting'): void {
  if (reason === 'unpaired') {
    if (wantsJson(ctx.req)) sendError(ctx.res, 401, 'unpaired', 'Este dispositivo no está emparejado.')
    else redirect(ctx.res, '/_hm/', 302)
    return
  }
  if (reason === 'starting') {
    if (wantsJson(ctx.req)) sendError(ctx.res, 503, 'harness-starting', 'El host Harness todavía no está listo.')
    else redirect(ctx.res, '/_hm/', 302)
    return
  }
  if (wantsJson(ctx.req)) sendError(ctx.res, 503, 'harness-inactive', 'La conexión con Harness está desactivada.')
  else redirect(ctx.res, '/_hm/?inactive=1', 302)
}
