import type { ActivationReader } from '../ports/activation-gateway.js'
import type { DeviceQueries } from '../ports/device-repository.js'
import type { DataPaths, HarnessSettings, NetworkSettings } from '../ports/settings.js'

export interface CertificateView {
  readonly notAfter: Date
  readonly fingerprint: string
  readonly sans: readonly string[]
}

export interface ReadStatusInput {
  readonly activation: ActivationReader
  readonly devices: DeviceQueries
  readonly network: NetworkSettings
  readonly harness: HarnessSettings
  readonly paths: DataPaths
  /** Raíz del log de sesiones ya resuelta por composición (incluye el separador del SO). */
  readonly sessionsRoot: string
  readonly certificate: CertificateView
  readonly version: string
  readonly now: Date
}

export function readStatus(input: ReadStatusInput): Record<string, unknown> {
  return {
    ...input.activation.snapshot(),
    network: {
      publicUrl: input.network.publicUrl,
      adminUrl: input.network.adminUrl,
      authority: input.network.authority,
      lanHost: input.network.lanHost,
    },
    cert: {
      notAfter: input.certificate.notAfter.toISOString(),
      fingerprint: input.certificate.fingerprint,
      sans: input.certificate.sans,
    },
    sessions: {
      mode: input.harness.sessions,
      root: input.sessionsRoot,
    },
    pairedDevices: input.devices.activeCount(),
    version: input.version,
    now: input.now.toISOString(),
  }
}
