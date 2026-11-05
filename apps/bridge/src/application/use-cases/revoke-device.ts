import { DeviceNotFoundError, NotAuthorizedError } from '../errors.js'
import type { Clock } from '../ports/clock.js'
import type { DeviceRepository } from '../ports/device-repository.js'

export interface RevokeRequester {
  readonly admin: boolean
  readonly deviceId: string | null
}

export interface RevokeDeviceDeps {
  readonly devices: DeviceRepository
  readonly clock: Clock
}

/** Un dispositivo solo puede revocarse a sí mismo; el panel de la PC, a cualquiera. */
export function assertCanRevoke(requester: RevokeRequester, targetId: string): void {
  if (requester.admin) return
  if (requester.deviceId === targetId) return
  throw new NotAuthorizedError()
}

export async function revokeDevice(deps: RevokeDeviceDeps, input: { id: string; requester: RevokeRequester }): Promise<void> {
  assertCanRevoke(input.requester, input.id)
  const revoked = await deps.devices.revoke(input.id, deps.clock.now().toISOString())
  if (!revoked) throw new DeviceNotFoundError()
}
