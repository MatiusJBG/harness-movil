import type { DataPaths, HarnessSettings, NetworkSettings } from '../../../application/ports/settings.js'
import type { TlsMaterial } from '../../../application/ports/tls-material-provider.js'
import type { RuntimeInfo } from '../../../application/use-cases/read-diagnostics.js'
import { readDiagnostics } from '../../../application/use-cases/read-diagnostics.js'
import { sendJson } from '../presenters/response.js'
import type { RequestContext } from '../router/route-definition.js'

export interface DiagnosticsControllerOptions {
  readonly version: string
  readonly runtime: RuntimeInfo
  readonly paths: DataPaths
  readonly harness: HarnessSettings
  readonly network: NetworkSettings
  readonly tls: TlsMaterial
}

export interface DiagnosticsController {
  readonly read: (ctx: RequestContext) => void
}

export function createDiagnosticsController(options: DiagnosticsControllerOptions): DiagnosticsController {
  return {
    read: (ctx): void => {
      sendJson(
        ctx.res,
        200,
        readDiagnostics({
          version: options.version,
          runtime: options.runtime,
          paths: options.paths,
          harness: options.harness,
          network: options.network,
          certificate: { notAfter: options.tls.notAfter, sans: options.tls.sans },
        }),
      )
    },
  }
}
