import type { PublicDevice } from '../../domain/device/device.js'
import type { ActivationReader, ActivationSnapshot } from '../ports/activation-gateway.js'

export interface SessionDeviceView {
  readonly id: string
  readonly name: string
}

export interface SessionView {
  readonly paired: boolean
  readonly admin: boolean
  readonly device: SessionDeviceView | null
  readonly activation: ActivationSnapshot
}

export interface ReadSessionInput {
  readonly admin: boolean
  readonly device: PublicDevice | null
  readonly activation: ActivationReader
}

/** Vista de sesión del panel: quién soy y en qué estado está la conexión. */
export function readSession(input: ReadSessionInput): SessionView {
  return {
    paired: input.admin || input.device !== null,
    admin: input.admin,
    device: input.device === null ? null : { id: input.device.id, name: input.device.name },
    activation: input.activation.snapshot(),
  }
}
