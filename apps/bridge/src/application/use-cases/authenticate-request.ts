import { isActiveDevice, markDeviceSeen, toPublicDevice, type Device, type PublicDevice } from '../../domain/device/device.js'
import { parseDeviceToken } from '../../domain/device/device-token.js'
import type { Clock } from '../ports/clock.js'
import type { DeviceQueries } from '../ports/device-repository.js'
import type { SecretHasher } from '../ports/secret-hasher.js'

export interface AuthenticateDeps {
  readonly devices: DeviceQueries & { update(device: Device): void }
  readonly hasher: SecretHasher
  readonly clock: Clock
}

/**
 * Autentica la cookie de dispositivo. Síncrono a propósito: el pedido no espera
 * a que se persista "visto por última vez" (el adaptador lo difiere).
 */
export function authenticateRequest(
  deps: AuthenticateDeps,
  input: { token: string | null; ip: string | null },
): PublicDevice | null {
  const parsed = parseDeviceToken(input.token)
  if (parsed === null) return null
  const record = deps.devices.find(parsed.id)
  if (record === null || !isActiveDevice(record)) return null
  if (!deps.hasher.matches(record.tokenHash, parsed.secret)) return null
  const seen = markDeviceSeen(record, deps.clock.now().toISOString(), input.ip)
  deps.devices.update(seen)
  return toPublicDevice(seen)
}
