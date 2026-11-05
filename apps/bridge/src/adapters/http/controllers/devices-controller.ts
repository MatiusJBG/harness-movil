import type { DeviceQueries } from '../../../application/ports/device-repository.js'
import type { Logger } from '../../../application/ports/logger.js'
import type { RevokeRequester } from '../../../application/use-cases/revoke-device.js'
import { listDevices } from '../../../application/use-cases/list-devices.js'
import { serializeClearedDeviceCookie } from '../presenters/cookies.js'
import { sendJson } from '../presenters/response.js'
import type { RequestContext } from '../router/route-definition.js'

export interface DevicesControllerOptions {
  readonly devices: DeviceQueries
  readonly revoke: (input: { id: string; requester: RevokeRequester }) => Promise<void>
  readonly logger: Logger
}

export interface DevicesController {
  readonly list: (ctx: RequestContext) => void
  readonly revoke: (ctx: RequestContext) => Promise<void>
}

export function createDevicesController(options: DevicesControllerOptions): DevicesController {
  return {
    list: (ctx): void => {
      const deviceId: string | null = ctx.device?.id ?? null
      sendJson(ctx.res, 200, listDevices({ devices: options.devices.list(), admin: ctx.admin, deviceId }))
    },
    revoke: async (ctx): Promise<void> => {
      const id = ctx.params.id ?? ''
      const requester: RevokeRequester = { admin: ctx.admin, deviceId: ctx.device?.id ?? null }
      await options.revoke({ id, requester })
      options.logger.info('dispositivo revocado', { deviceId: id })
      const headers: Record<string, string> = {}
      if (!ctx.admin && ctx.device?.id === id) headers['set-cookie'] = serializeClearedDeviceCookie()
      sendJson(ctx.res, 200, { revoked: true }, headers)
    },
  }
}
