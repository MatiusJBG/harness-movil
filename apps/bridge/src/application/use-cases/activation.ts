import { transition, type ActivationState } from '../../domain/activation/activation-state.js'
import type {
  ActivationControl,
  ActivationReader,
  ActivationSnapshot,
  ActivationSubscription,
  ActivityMarker,
} from '../ports/activation-gateway.js'
import type { Clock } from '../ports/clock.js'
import type { HarnessLaunch, HarnessSupervisor } from '../ports/harness-supervisor.js'
import type { Logger } from '../ports/logger.js'
import type { SessionCookieStore } from '../ports/session-cookie-store.js'

export interface Scheduler {
  setInterval(callback: () => void, ms: number): unknown
  clearInterval(handle: unknown): void
}

const defaultScheduler: Scheduler = {
  setInterval(callback, ms) {
    const handle = setInterval(callback, ms)
    handle.unref()
    return handle
  },
  clearInterval(handle) {
    clearInterval(handle as ReturnType<typeof setInterval>)
  },
}

export interface ActivationOptions {
  readonly supervisor: HarnessSupervisor
  readonly cookies: SessionCookieStore
  readonly logger: Logger
  readonly clock: Clock
  readonly idleAutoOffMinutes: number
  /** Intervalo del chequeo de inactividad; los tests lo acortan. */
  readonly idleCheckMs?: number
  readonly scheduler?: Scheduler
}

/**
 * Orquestador de la conexión con Harness. Solo depende de puertos: la máquina de
 * estados (dominio), el supervisor, la cookie, el reloj y el logger se inyectan.
 */
export class Activation implements ActivationReader, ActivationControl, ActivationSubscription, ActivityMarker {
  private stateValue: ActivationState = 'inactive'
  private errorValue: string | null = null
  private launch: HarnessLaunch | null = null
  private lastActivity: number | null = null
  private chain: Promise<void> = Promise.resolve()
  private idleTimer: unknown = null
  private readonly listeners = new Set<(snapshot: ActivationSnapshot) => void>()
  private readonly unsubscribeExit: () => void
  private readonly scheduler: Scheduler

  constructor(private readonly options: ActivationOptions) {
    this.scheduler = options.scheduler ?? defaultScheduler
    this.unsubscribeExit = options.supervisor.onExit(() => {
      if (this.stateValue !== 'active' && this.stateValue !== 'starting') return
      this.options.cookies.clear()
      this.launch = null
      this.setState('error', 'El host Harness se cerró inesperadamente.')
    })
  }

  state(): ActivationState {
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
      port: this.launch?.port ?? null,
      pid: this.launch?.pid ?? null,
      startedAt: this.launch?.startedAt ?? null,
      lastActivityAt: this.lastActivity,
    }
  }

  subscribe(listener: (snapshot: ActivationSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Marca actividad para el apagado por inactividad (cada pedido proxeado). */
  touch(): void {
    if (this.stateValue === 'active') this.lastActivity = this.options.clock.nowMs()
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
    this.setState(transition(this.stateValue, 'activate'), null)
    try {
      const launch = await this.options.supervisor.start()
      await this.options.cookies.exchange({ port: launch.port, token: launch.token })
      this.launch = launch
      this.lastActivity = this.options.clock.nowMs()
      this.ensureIdleTimer()
      this.setState(transition(this.stateValue, 'started'), null)
      this.options.logger.info('conexión Harness activa', { port: launch.port })
    } catch (error) {
      this.options.cookies.clear()
      this.launch = null
      await this.options.supervisor.stop().catch(() => undefined)
      const message = error instanceof Error ? error.message : String(error)
      this.setState(transition(this.stateValue, 'start-failed'), message)
      this.options.logger.error('no se pudo activar la conexión', { error: message })
      throw error
    }
  }

  private async doDeactivate(reason: string): Promise<void> {
    if (this.stateValue === 'inactive' || this.stateValue === 'stopping') return
    this.setState(transition(this.stateValue, 'deactivate'), null)
    try {
      await this.options.supervisor.stop()
    } finally {
      this.options.cookies.clear()
      this.launch = null
      this.lastActivity = null
      this.clearIdleTimer()
      this.setState(transition(this.stateValue, 'stopped'), null)
      this.options.logger.info('conexión Harness desactivada', { reason })
    }
  }

  private ensureIdleTimer(): void {
    if (this.idleTimer !== null || this.options.idleAutoOffMinutes <= 0) return
    const interval = this.options.idleCheckMs ?? 30_000
    this.idleTimer = this.scheduler.setInterval(() => {
      this.checkIdle()
    }, interval)
  }

  private clearIdleTimer(): void {
    if (this.idleTimer === null) return
    this.scheduler.clearInterval(this.idleTimer)
    this.idleTimer = null
  }

  private checkIdle(): void {
    if (this.stateValue !== 'active' || this.options.idleAutoOffMinutes <= 0) return
    const last = this.lastActivity ?? this.options.clock.nowMs()
    const idleMs = this.options.clock.nowMs() - last
    if (idleMs < this.options.idleAutoOffMinutes * 60_000) return
    this.options.logger.info('apagando la conexión por inactividad', {
      idleMinutes: Math.round(idleMs / 60_000),
    })
    void this.deactivate('idle')
  }

  private setState(next: ActivationState, error: string | null): void {
    this.stateValue = next
    this.errorValue = error
    const snapshot = this.snapshot()
    for (const listener of this.listeners) {
      try {
        listener(snapshot)
      } catch {
        // un listener no puede romper la máquina de estados
      }
    }
  }
}
