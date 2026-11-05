export type ActivationState = 'inactive' | 'starting' | 'active' | 'stopping' | 'error'

export type ActivationEvent =
  | 'activate'
  | 'started'
  | 'start-failed'
  | 'deactivate'
  | 'stopped'
  | 'crash'
  | 'shutdown'

/**
 * Máquina de estados pura. Modela los mismos estados que el puente exponía,
 * pero la tabla es verificable sin spawn, timers ni red.
 */
export function transition(state: ActivationState, event: ActivationEvent): ActivationState {
  switch (event) {
    case 'activate':
      return state === 'active' ? 'active' : 'starting'
    case 'started':
      return state === 'starting' ? 'active' : state
    case 'start-failed':
      return state === 'starting' ? 'error' : state
    case 'deactivate':
      return state === 'inactive' ? 'inactive' : 'stopping'
    case 'stopped':
      return state === 'stopping' ? 'inactive' : state
    case 'crash':
      return state === 'active' || state === 'starting' ? 'error' : state
    case 'shutdown':
      return 'inactive'
    default:
      return assertNever(event)
  }
}

export function isActiveState(state: ActivationState): boolean {
  return state === 'active'
}

export function canStart(state: ActivationState): boolean {
  return state !== 'active' && state !== 'starting'
}

function assertNever(value: never): never {
  throw new Error(`Evento de activación desconocido: ${String(value)}`)
}
