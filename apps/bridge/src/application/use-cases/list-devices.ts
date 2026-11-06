import { isActiveDevice, toPublicDevice, type Device, type PublicDevice } from '../../domain/device/device.js'

export interface ListDevicesInput {
  readonly devices: readonly Device[]
  readonly admin: boolean
  readonly deviceId: string | null
}

export interface ListDevicesView {
  readonly devices: readonly PublicDevice[]
  readonly admin: boolean
}

/** Un teléfono ve su propio registro; el panel de la PC ve todos los activos. */
export function listDevices(input: ListDevicesInput): ListDevicesView {
  const active = input.devices.filter(isActiveDevice).map(toPublicDevice)
  return {
    devices: input.admin ? active : active.filter((entry) => entry.id === input.deviceId),
    admin: input.admin,
  }
}
