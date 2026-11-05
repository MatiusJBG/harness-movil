import type { AssetSource } from '../static/asset-manifest.js'
import { sendError } from '../presenters/response.js'
import type { RequestContext } from '../router/route-definition.js'

export interface AssetsControllerOptions {
  readonly assets: AssetSource
}

export interface AssetsController {
  readonly get: (ctx: RequestContext) => void
}

export function createAssetsController(options: AssetsControllerOptions): AssetsController {
  return {
    get: (ctx): void => {
      const asset = options.assets.get(ctx.path)
      if (asset === null) {
        sendError(ctx.res, 404, 'not-found', 'No encontrado.')
        return
      }
      ctx.res.writeHead(200, {
        'content-type': asset.type,
        'cache-control': asset.cacheControl,
        'content-length': asset.body.length,
      })
      ctx.res.end(ctx.req.method === 'HEAD' ? undefined : asset.body)
    },
  }
}
