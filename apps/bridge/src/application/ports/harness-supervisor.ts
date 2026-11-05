export interface HarnessLaunch {
  readonly pid: number
  readonly port: number
  readonly token: string
  readonly startedAt: number
  readonly command: string
}

export interface HarnessSupervisor {
  start(): Promise<HarnessLaunch>
  /** Debe ser idempotente. */
  stop(): Promise<void>
  isRunning(): boolean
  /** El listener no se dispara tras un stop() deliberado. */
  onExit(listener: (last: HarnessLaunch | null) => void): () => void
}
