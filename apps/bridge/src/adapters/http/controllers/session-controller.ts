import type { PublicDevice } from '../../../domain/device/device.js'
import type { ActivationReader } from '../../../application/ports/activation-gateway.js'
import { readSession } from '../../../application/use-cases/read-session.js'
import { serializeClearedDeviceCookie } from '../presenters/cookies.js'
import { sendJson } from '../presenters/response.js'
import type { RequestContext } from '../router/route-definition.js'

export interface SessionControllerOptions {
  readonly activation: ActivationReader
  readonly signOut: (input: { device: PublicDevice | null }) => Promise<void>
}

export interface SessionController {
  readonly read: (ctx: RequestContext) => void
  readonly signOut: (ctx: RequestContext) => Promise<void>
}

export function createSessionController(options: SessionControllerOptions): SessionController {
  return {
    read: (ctx): void => {
      sendJson(ctx.res, 200, readSession({ admin: ctx.admin, device: ctx.device, activation: options.activation }))
    },
    signOut: async (ctx): Promise<void> => {
      await options.signOut({ device: ctx.device })
      sendJson(ctx.res, 200, { ok: true }, { 'set-cookie': serializeClearedDeviceCookie() })
    },
  }
}
