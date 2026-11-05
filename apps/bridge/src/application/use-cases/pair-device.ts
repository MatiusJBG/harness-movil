import { createDevice, toPublicDevice, type PublicDevice } from '../../domain/device/device.js'
import { formatDeviceToken } from '../../domain/device/device-token.js'
import { DeviceLimitReachedError, TicketInvalidError } from '../errors.js'
import type { Clock } from '../ports/clock.js'
import type { DeviceRepository } from '../ports/device-repository.js'
import type { IdGenerator } from '../ports/id-generator.js'
import type { PairingTicketStore } from '../ports/pairing-ticket-store.js'
import type { SecretHasher } from '../ports/secret-hasher.js'

export interface PairDeviceDeps {
  readonly tickets: PairingTicketStore
  readonly devices: DeviceRepository
  readonly hasher: SecretHasher
  readonly ids: IdGenerator
  readonly clock: Clock
}

export interface PairDeviceInput {
  readonly code?: unknown
  readonly secret?: unknown
  readonly name?: unknown
  readonly ip?: string | null
  readonly maxDevices: number
}

export interface PairDeviceResult {
  readonly device: PublicDevice
  readonly token: string
}

/**
 * Canjea un ticket de un solo uso y registra el dispositivo. El canje ocurre de
 * forma atómica antes de cualquier `await`, así dos pedidos concurrentes no
 * pueden reutilizar el mismo ticket.
 */
export async function pairDevice(deps: PairDeviceDeps, input: PairDeviceInput): Promise<PairDeviceResult> {
  const nowMs = deps.clock.nowMs()
  if (deps.tickets.current(nowMs) === null) throw new TicketInvalidError()
  if (deps.devices.activeCount() >= input.maxDevices) throw new DeviceLimitReachedError(input.maxDevices)

  const ticket = deps.tickets.redeem(
    {
      code: typeof input.code === 'string' ? input.code : '',
      secret: typeof input.secret === 'string' ? input.secret : '',
    },
    nowMs,
  )
  if (ticket === null) throw new TicketInvalidError()

  const id = deps.ids.deviceId()
  const secret = deps.ids.deviceSecret()
  const device = createDevice({
    id,
    name: input.name,
    tokenHash: deps.hasher.hash(secret),
    ip: input.ip ?? null,
    timestamp: deps.clock.now().toISOString(),
  })
  await deps.devices.add(device)
  return { device: toPublicDevice(device), token: formatDeviceToken(id, secret) }
}
