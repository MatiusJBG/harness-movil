import type { TlsMaterial } from '../../../application/ports/tls-material-provider.js'
import { sendBytes, sendError, sendText } from '../presenters/response.js'
import type { RequestContext } from '../router/route-definition.js'

export interface CaControllerOptions {
  readonly tls: TlsMaterial
}

export interface CaController {
  readonly der: (ctx: RequestContext) => void
  readonly pem: (ctx: RequestContext) => void
}

/** Entrega la CA pública para instalarla en el teléfono (nunca la clave). */
export function createCaController(options: CaControllerOptions): CaController {
  return {
    der: (ctx): void => {
      const { caDer } = options.tls
      if (caDer === null) {
        sendError(ctx.res, 404, 'no-local-ca', 'El certificado se configuró con archivos externos; usá /_hm/ca.pem.')
        return
      }
      sendBytes(ctx.res, 200, caDer, 'application/x-x509-ca-cert', {
        'content-disposition': 'attachment; filename="harness-movil-ca.cer"',
      })
    },
    pem: (ctx): void => {
      if (options.tls.caPem === null) {
        sendError(ctx.res, 404, 'no-local-ca', 'No hay CA local disponible.')
        return
      }
      sendText(ctx.res, 200, options.tls.caPem, 'application/x-pem-file; charset=utf-8')
    },
  }
}
