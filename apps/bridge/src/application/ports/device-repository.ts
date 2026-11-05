import type { Device, PublicDevice } from '../../domain/device/device.js'

/** Lectura: la usan el listado, el estado y la autenticación. */
export interface DeviceQueries {
  load(): Promise<void>
  list(): Device[]
  activeCount(): number
  find(id: string): Device | null
}

/** Escritura: alta y revocación esperan durabilidad; update es best-effort. */
export interface DeviceMutations {
  add(device: Device): Promise<void>
  /** Persiste "visto por última vez" sin bloquear el pedido (throttle del adaptador). */
  update(device: Device): void
  revoke(id: string, timestamp: string): Promise<boolean>
  revokeAll(timestamp: string): Promise<number>
}

export interface DeviceRepository extends DeviceQueries, DeviceMutations {}

export type DeviceListing = readonly PublicDevice[]
