import type { DataPaths, HarnessSettings, NetworkSettings } from '../ports/settings.js'

export interface RuntimeInfo {
  readonly node: string
  readonly platform: string
}

export interface ReadDiagnosticsInput {
  readonly version: string
  readonly runtime: RuntimeInfo
  readonly paths: DataPaths
  readonly harness: HarnessSettings
  readonly network: NetworkSettings
  readonly certificate: { notAfter: Date; sans: readonly string[] }
}

/** Diagnóstico solo-PC: rutas, perfil y certificado, sin secretos. */
export function readDiagnostics(input: ReadDiagnosticsInput): Record<string, unknown> {
  return {
    version: input.version,
    node: input.runtime.node,
    platform: input.runtime.platform,
    dataDir: input.paths.dataDir,
    dshHome: input.paths.dshHome,
    profile: input.harness.profile,
    command: input.harness.command,
    sessions: input.harness.sessions,
    bind: `${input.network.bindHost}:${String(input.network.port)}`,
    admin: input.network.adminAuthority,
    tls: { notAfter: input.certificate.notAfter.toISOString(), sans: input.certificate.sans },
  }
}
