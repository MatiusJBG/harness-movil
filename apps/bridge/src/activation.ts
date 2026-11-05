import type { DshStartInfo, DshSupervisor } from './dsh.js'
import type { DshJar } from './jar.js'
import type { Logger } from './log.js'

export type ActivationState = 'inactive' | 'starting' | 'active' | 'stopping' | 'error'

export interface ActivationSnapshot {
  state: ActivationState
  active: boolean
  error: string | null
  port: number | null
  pid: number | null
  startedAt: number | null
  lastActivityAt: number | null
}

export interface SupervisorLike {
  start(): Promise<DshStartInfo>
  stop(): Promise<void>
  running(): boolean
  onExit(listener: (info: DshStartInfo | null) => void): () => void
}

export interface JarLike {
  exchange(options: { port: number; token: string }): Promise<void>
  clear(): void
  header(): string | undefined
}

export interface ActivationOptions {
  supervisor: Pick<DshSupervisor, 'start' | 'stop' | 'running' | 'onExit'> | SupervisorLike
  jar: Pick<DshJar, 'exchange' | 'clear' | 'header'> | JarLike
  logger: Logger
  idleAutoOffMinutes: number
  now?: () => number
  /** Interval for the idle check, mainly lowered by tests. */
  idleCheckMs?: number
}

export class Activation {
  private stateValue: ActivationState = 'inactive'
  private errorValue: string | null = null
  private info: DshStartInfo | null = null
  private lastActivity: number | null = null
  private chain: Promise<void> = Promise.resolve()
  private idleTimer: NodeJS.Timeout | null = null
  private readonly listeners = new Set<(snapshot: ActivationSnapshot) => void>()
  private readonly unsubscribeExit: () => void
  private readonly now: () => number

  constructor(private readonly options: ActivationOptions) {
    this.now = options.now ?? (() => Date.now())
    this.unsubscribeExit = options.supervisor.onExit(() => {
      if (this.stateValue === 'active' || this.stateValue === 'starting') {
        this.jar().clear()
        this.info = null
        this.setState('error', 'El host Harness se cerró inesperadamente.')
      }
    })
  }

  get state(): ActivationState {
    return this.stateValue
  }

  isActive(): boolean {
    return this.stateValue === 'active'
  }

  snapshot(): ActivationSnapshot {
    return {
      state: this.stateValue,
      active: this.stateValue === 'active',
      error: this.errorValue,
      port: this.info?.port ?? null,
      pid: this.info?.pid ?? null,
      startedAt: this.info?.startedAt ?? null,
      lastActivityAt: this.lastActivity,
    }
  }

  subscribe(listener: (snapshot: ActivationSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Marks activity for the idle timer; call on every proxied request. */
  touch(): void {
    if (this.stateValue === 'active') this.lastActivity = this.now()
  }

  activate(): Promise<void> {
    this.chain = this.chain.then(
      () => this.doActivate(),
      () => this.doActivate(),
    )
    return this.chain
  }

  deactivate(reason = 'manual'): Promise<void> {
    this.chain = this.chain.then(
      () => this.doDeactivate(reason),
      () => this.doDeactivate(reason),
    )
    return this.chain
  }

  async dispose(): Promise<void> {
    this.clearIdleTimer()
    this.unsubscribeExit()
    await this.deactivate('shutdown').catch(() => undefined)
  }

  private async doActivate(): Promise<void> {
    if (this.stateValue === 'active') return
    this.setState('starting', null)
    try {
      const info = await this.options.supervisor.start()
      await this.jar().exchange({ port: info.port, token: info.token })
      this.info = info
      this.lastActivity = this.now()
      this.ensureIdleTimer()
      this.setState('active', null)
      this.options.logger.info('conexión Harness activa', { port: info.port })
    } catch (error) {
      this.jar().clear()
      this.info = null
      await this.options.supervisor.stop().catch(() => undefined)
      const message = error instanceof Error ? error.message : String(error)
      this.setState('error', message)
      this.options.logger.error('no se pudo activar la conexión', { error: message })
      throw error
    }
  }

  private async doDeactivate(reason: string): Promise<void> {
    if (this.stateValue === 'inactive' || this.stateValue === 'stopping') return
    this.setState('stopping', null)
    try {
      await this.options.supervisor.stop()
    } finally {
      this.jar().clear()
      this.info = null
      this.lastActivity = null
      this.clearIdleTimer()
      this.setState('inactive', null)
      this.options.logger.info('conexión Harness desactivada', { reason })
    }
  }

  private ensureIdleTimer(): void {
    if (this.idleTimer || this.options.idleAutoOffMinutes <= 0) return
    const interval = this.options.idleCheckMs ?? 30_000
    this.idleTimer = setInterval(() => this.checkIdle(), interval)
    this.idleTimer.unref?.()
  }

  private clearIdleTimer(): void {
    if (!this.idleTimer) return
    clearInterval(this.idleTimer)
    this.idleTimer = null
  }

  private checkIdle(): void {
    if (this.stateValue !== 'active' || this.options.idleAutoOffMinutes <= 0) return
    const last = this.lastActivity ?? this.now()
    const idleMs = this.now() - last
    if (idleMs >= this.options.idleAutoOffMinutes * 60_000) {
      this.options.logger.info('apagando la conexión por inactividad', {
        idleMinutes: Math.round(idleMs / 60_000),
      })
      void this.deactivate('idle')
    }
  }

  private jar(): JarLike {
    return this.options.jar as JarLike
  }

  private setState(next: ActivationState, error: string | null): void {
    this.stateValue = next
    this.errorValue = error
    const snapshot = this.snapshot()
    for (const listener of this.listeners) {
      try {
        listener(snapshot)
      } catch {
        // listeners must not break the state machine
      }
    }
  }
}
