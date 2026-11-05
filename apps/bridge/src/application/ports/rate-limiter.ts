export interface RateLimiter {
  tryConsume(key: string): boolean
  reset(key?: string): void
}
