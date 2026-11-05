import type { ActivationState } from '../../domain/activation/activation-state.js'

export interface ActivationSnapshot {
  readonly state: ActivationState
  readonly active: boolean
  readonly error: string | null
  readonly port: number | null
  readonly pid: number | null
  readonly startedAt: number | null
  readonly lastActivityAt: number | null
}

export interface ActivationReader {
  state(): ActivationState
  snapshot(): ActivationSnapshot
  isActive(): boolean
}

export interface ActivationControl {
  activate(): Promise<void>
  deactivate(reason?: string): Promise<void>
  dispose(): Promise<void>
}

export interface ActivityMarker {
  touch(): void
}

export interface ActivationSubscription {
  subscribe(listener: (snapshot: ActivationSnapshot) => void): () => void
}
