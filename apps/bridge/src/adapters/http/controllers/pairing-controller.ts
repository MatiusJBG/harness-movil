import QRCode from 'qrcode'
import type { RateLimiter } from '../../../application/ports/rate-limiter.js'
import type { Logger } from '../../../application/ports/logger.js'
import type { PairDeviceInput, PairDeviceResult } from '../../../application/use-cases/pair-device.js'
import type { PairingTicket } from '../../../domain/pairing/pairing-ticket.js'
import { serializeDeviceCookie } from '../presenters/cookies.js'
import { sendJson } from '../presenters/response.js'
import { readJsonBody } from '../middleware/request-meta.js'
import type { RequestContext } from '../router/route-definition.js'

export interface PairingControllerOptions {
  readonly pair: (input: PairDeviceInput) => Promise<PairDeviceResult>
  readonly readTicket: () => PairingTicket
  readonly refreshTicket: () => PairingTicket
  readonly publicUrl: string
  readonly maxBodyBytes: number
  readonly maxDevices: number
  readonly limiter: RateLimiter
  readonly logger: Logger
}

export interface PairingView {
  readonly code: string
  readonly expiresAt: string
  readonly url: string
  readonly qrDataUrl: string
}

export interface PairingController {
  readonly claim: (ctx: RequestContext) => Promise<void>
  readonly read: (ctx: RequestContext) => Promise<void>
  readonly refresh: (ctx: RequestContext) => Promise<void>
}

export function createPairingController(options: PairingControllerOptions): PairingController {
  const view = async (ticket: PairingTicket): Promise<PairingView> => {
    const url = `${options.publicUrl}_hm/#p=${encodeURIComponent(ticket.secret)}`
    return {
      code: ticket.code,
      expiresAt: new Date(ticket.expiresAt).toISOString(),
      url,
      qrDataUrl: await QRCode.toDataURL(url, { margin: 1, width: 480, errorCorrectionLevel: 'M' }),
    }
  }

  return {
    /** Canje del código/QR: el ticket se consume de forma atómica en el caso de uso. */
    claim: async (ctx): Promise<void> => {
      const raw = await readJsonBody(ctx.req, options.maxBodyBytes)
      const body = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
      const result = await options.pair({
        code: body.code,
        secret: body.secret,
        name: body.name,
        ip: ctx.ip,
        maxDevices: options.maxDevices,
      })
      options.limiter.reset(ctx.ip)
      options.logger.info('dispositivo emparejado', { deviceId: result.device.id, ip: ctx.ip })
      sendJson(ctx.res, 200, { device: result.device }, { 'set-cookie': serializeDeviceCookie(result.token) })
    },
    read: async (ctx): Promise<void> => {
      sendJson(ctx.res, 200, await view(options.readTicket()))
    },
    refresh: async (ctx): Promise<void> => {
      const ticket = options.refreshTicket()
      options.logger.info('nuevo código de emparejamiento generado')
      sendJson(ctx.res, 200, await view(ticket))
    },
  }
}
