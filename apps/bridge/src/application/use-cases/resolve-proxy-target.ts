import type { PublicDevice } from '../../domain/device/device.js'
import type { ActivationSnapshot } from '../ports/activation-gateway.js'

export type ProxyDenialReason = 'unpaired' | 'inactive' | 'starting'

export type ProxyDecision =
  | { readonly kind: 'allow'; readonly port: number }
  | { readonly kind: 'deny'; readonly reason: ProxyDenialReason }

export interface ResolveProxyTargetInput {
  readonly device: PublicDevice | null
  readonly admin: boolean
  readonly activation: ActivationSnapshot
}

/**
 * Única puerta de entrada al host Harness, compartida por HTTP y WebSocket.
 * Antes esta lógica estaba duplicada en `handle` y `handleUpgrade`.
 */
export function resolveProxyTarget(input: ResolveProxyTargetInput): ProxyDecision {
  if (!input.admin && input.device === null) return { kind: 'deny', reason: 'unpaired' }
  if (!input.activation.active) {
    return { kind: 'deny', reason: input.activation.state === 'starting' ? 'starting' : 'inactive' }
  }
  if (input.activation.port === null) return { kind: 'deny', reason: 'starting' }
  return { kind: 'allow', port: input.activation.port }
}
