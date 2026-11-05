import type { ActivationReader } from '../../../application/ports/activation-gateway.js'
import type { Clock } from '../../../application/ports/clock.js'
import type { DeviceQueries } from '../../../application/ports/device-repository.js'
import type { DataPaths, HarnessSettings, NetworkSettings } from '../../../application/ports/settings.js'
import type { TlsMaterial } from '../../../application/ports/tls-material-provider.js'
import { readStatus } from '../../../application/use-cases/read-status.js'
import { sendJson } from '../presenters/response.js'
import type { RequestContext } from '../router/route-definition.js'

export interface StatusControllerOptions {
  readonly activation: ActivationReader
  readonly devices: DeviceQueries
  readonly network: NetworkSettings
  readonly harness: HarnessSettings
  readonly paths: DataPaths
  readonly sessionsRoot: string
  readonly tls: TlsMaterial
  readonly version: string
  readonly clock: Clock
}

export interface StatusController {
  readonly read: (ctx: RequestContext) => void
}

export function createStatusController(options: StatusControllerOptions): StatusController {
  return {
    read: (ctx): void => {
      sendJson(
        ctx.res,
        200,
        readStatus({
          activation: options.activation,
          devices: options.devices,
          network: options.network,
          harness: options.harness,
          paths: options.paths,
          sessionsRoot: options.sessionsRoot,
          certificate: { notAfter: options.tls.notAfter, fingerprint: options.tls.fingerprint, sans: options.tls.sans },
          version: options.version,
          now: options.clock.now(),
        }),
      )
    },
  }
}
