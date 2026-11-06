import type { Scheduler } from '../../application/ports/scheduler.js'

/** Temporizador real del proceso; `unref()` evita que retenga el event loop. */
export const nodeScheduler: Scheduler = {
  setInterval(callback, ms) {
    const handle = setInterval(callback, ms)
    handle.unref()
    return handle
  },
  clearInterval(handle) {
    clearInterval(handle as ReturnType<typeof setInterval>)
  },
}
