import { toPublicDevice, type Device, type PublicDevice } from '../../domain/device/device.js'

export interface ListDevicesInput {
  readonly devices: readonly Device[]
  readonly admin: boolean
  readonly deviceId: string | null
}

export interface ListDevicesView {
  readonly devices: readonly PublicDevice[]
  readonly admin: boolean
}

/** Un teléfono ve su propio registro; el panel de la PC ve todos. */
export function listDevices(input: ListDevicesInput): ListDevicesView {
  const all = input.devices.map(toPublicDevice)
  return {
    devices: input.admin ? all : all.filter((entry) => entry.id === input.deviceId),
    admin: input.admin,
  }
}
