import { describe, expect, it } from '../helpers/testkit.js'
import { canStart, isActiveState, transition } from '../../src/domain/activation/activation-state.js'
import type { ActivationEvent, ActivationState } from '../../src/domain/activation/activation-state.js'

describe('máquina de estados de activación', () => {
  it('recorre el camino feliz', () => {
    const started = transition('inactive', 'activate')
    expect(started).toBe('starting')
    const active = transition(started, 'started')
    expect(active).toBe('active')
    expect(isActiveState(active)).toBe(true)
    const stopping = transition(active, 'deactivate')
    expect(stopping).toBe('stopping')
    expect(transition(stopping, 'stopped')).toBe('inactive')
  })

  it('activa desde error y es idempotente desde active', () => {
    expect(transition('error', 'activate')).toBe('starting')
    expect(transition('active', 'activate')).toBe('active')
  })

  it('marca error cuando el arranque falla o el host se cae', () => {
    expect(transition('starting', 'start-failed')).toBe('error')
    expect(transition('active', 'crash')).toBe('error')
    expect(transition('starting', 'crash')).toBe('error')
    expect(transition('inactive', 'crash')).toBe('inactive')
  })

  it('desactivar desde inactivo no cambia el estado', () => {
    expect(transition('inactive', 'deactivate')).toBe('inactive')
    expect(transition('stopping', 'deactivate')).toBe('stopping')
  })

  it('shutdown siempre deja inactivo', () => {
    expect(transition('active', 'shutdown')).toBe('inactive')
    expect(transition('error', 'shutdown')).toBe('inactive')
  })

  it('started/stopped fuera de contexto no alteran el estado', () => {
    expect(transition('inactive', 'started')).toBe('inactive')
    expect(transition('active', 'stopped')).toBe('active')
  })

  it('canStart bloquea mientras arranca o está activo', () => {
    const cases: Array<[ActivationState, boolean]> = [
      ['inactive', true],
      ['error', true],
      ['starting', false],
      ['active', false],
      ['stopping', true],
    ]
    for (const [state, expected] of cases) expect(canStart(state)).toBe(expected)
  })

  it('es total: ningún evento deja el estado indefinido', () => {
    const states: ActivationState[] = ['inactive', 'starting', 'active', 'stopping', 'error']
    const events: ActivationEvent[] = ['activate', 'started', 'start-failed', 'deactivate', 'stopped', 'crash', 'shutdown']
    for (const state of states) {
      for (const event of events) {
        expect(states.includes(transition(state, event))).toBe(true)
      }
    }
  })
})
