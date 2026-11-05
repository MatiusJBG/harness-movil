import type { PublicDevice } from '../../domain/device/device.js'
import type { Clock } from '../ports/clock.js'
import type { DeviceRepository } from '../ports/device-repository.js'

/** Cerrar sesión revoca el dispositivo actual (si lo hay) y limpia la cookie. */
export async function signOutDevice(
  deps: { devices: DeviceRepository; clock: Clock },
  input: { device: PublicDevice | null },
): Promise<void> {
  if (input.device === null) return
  await deps.devices.revoke(input.device.id, deps.clock.now().toISOString())
}
