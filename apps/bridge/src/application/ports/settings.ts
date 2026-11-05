import type { SessionScope } from '../../domain/harness/session-scope.js'

export interface DataPaths {
  readonly dataDir: string
  readonly configFile: string
  readonly tlsDir: string
  readonly devicesFile: string
  readonly logDir: string
  readonly dshHome: string
}

export interface NetworkSettings {
  readonly bindHost: string
  readonly lanHost: string
  readonly publicHost: string
  readonly port: number
  readonly adminHost: string
  readonly adminPort: number
  readonly authority: string
  readonly adminAuthority: string
  readonly publicUrl: string
  readonly adminUrl: string
}

export interface HarnessSettings {
  readonly command: string
  readonly profile: string
  readonly home: string | null
  readonly sessions: SessionScope
  readonly extraArgs: readonly string[]
  readonly startTimeoutMs: number
}

export interface PairingSettings {
  readonly ticketTtlSeconds: number
  readonly maxDevices: number
}

export interface ActivationSettings {
  readonly autoStart: boolean
  readonly idleAutoOffMinutes: number
}

export interface LimitsSettings {
  readonly pairingPerMinute: number
  readonly maxBodyBytes: number
}

export interface TlsSettings {
  readonly mode: 'local-ca' | 'files'
  readonly certFile: string | null
  readonly keyFile: string | null
  readonly caFile: string | null
}

export interface AppSettings {
  readonly paths: DataPaths
  readonly network: NetworkSettings
  readonly harness: HarnessSettings
  readonly pairing: PairingSettings
  readonly activation: ActivationSettings
  readonly limits: LimitsSettings
  readonly tls: TlsSettings
}
