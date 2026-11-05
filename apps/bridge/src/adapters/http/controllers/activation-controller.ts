import type { ActivationControl, ActivationReader } from '../../../application/ports/activation-gateway.js'
import type { Logger } from '../../../application/ports/logger.js'
import { sendJson } from '../presenters/response.js'
import type { RequestContext } from '../router/route-definition.js'

export interface ActivationControllerOptions {
  readonly activation: ActivationReader & ActivationControl
  readonly logger: Logger
}

export interface ActivationController {
  readonly read: (ctx: RequestContext) => void
  readonly activate: (ctx: RequestContext) => void
  readonly deactivate: (ctx: RequestContext) => Promise<void>
}

export function createActivationController(options: ActivationControllerOptions): ActivationController {
  const { activation } = options
  return {
    read: (ctx): void => {
      sendJson(ctx.res, 200, activation.snapshot())
    },
    activate: (ctx): void => {
      if (!activation.isActive() && activation.state() !== 'starting') {
        void activation.activate().catch((error: unknown) => {
          options.logger.error('falló la activación', { error: error instanceof Error ? error.message : String(error) })
        })
      }
      sendJson(ctx.res, 202, activation.snapshot())
    },
    deactivate: async (ctx): Promise<void> => {
      await activation.deactivate('phone')
      sendJson(ctx.res, 200, activation.snapshot())
    },
  }
}
