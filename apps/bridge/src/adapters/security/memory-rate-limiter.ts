import type { Clock } from '../../application/ports/clock.js'
import type { RateLimiter } from '../../application/ports/rate-limiter.js'

/** Ventana deslizante en memoria, por clave (IP). Inyecta el reloj para testearlo. */
export class MemoryRateLimiter implements RateLimiter {
  private readonly hits = new Map<string, number[]>()

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly clock: Clock,
  ) {}

  tryConsume(key: string): boolean {
    const current = this.clock.nowMs()
    const recent = (this.hits.get(key) ?? []).filter((timestamp) => current - timestamp < this.windowMs)
    if (recent.length >= this.limit) {
      this.hits.set(key, recent)
      return false
    }
    recent.push(current)
    this.hits.set(key, recent)
    return true
  }

  reset(key?: string): void {
    if (key === undefined) this.hits.clear()
    else this.hits.delete(key)
  }
}
