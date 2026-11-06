/**
 * Puerto de temporización. La aplicación no conoce `setInterval`: composición
 * inyecta el adaptador real y los tests un doble determinista.
 */
export interface Scheduler {
  setInterval(callback: () => void, ms: number): unknown
  clearInterval(handle: unknown): void
}
