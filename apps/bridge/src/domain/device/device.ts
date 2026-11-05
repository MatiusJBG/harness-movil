import { DomainError } from '../shared/domain-error.js'
import { sanitizeDeviceName } from './device-name.js'

export interface Device {
  readonly id: string
  readonly name: string
  readonly tokenHash: string
  readonly createdAt: string
  readonly lastSeenAt: string
  readonly lastIp: string | null
  readonly revokedAt: string | null
}

/** Proyección sin el hash: es lo único que puede salir del puente. */
export interface PublicDevice {
  readonly id: string
  readonly name: string
  readonly createdAt: string
  readonly lastSeenAt: string
  readonly lastIp: string | null
  readonly revokedAt: string | null
}

export interface CreateDeviceInput {
  id: string
  name: unknown
  tokenHash: string
  ip: string | null
  timestamp: string
}

/** Fábrica única del registro: centraliza las invariantes de la entidad. */
export function createDevice(input: CreateDeviceInput): Device {
  if (input.id.trim() === '') {
    throw new DomainError('El identificador del dispositivo no puede estar vacío.', 'device-id-empty')
  }
  if (input.tokenHash.trim() === '') {
    throw new DomainError('El hash del token no puede estar vacío.', 'device-hash-empty')
  }
  return {
    id: input.id,
    name: sanitizeDeviceName(input.name),
    tokenHash: input.tokenHash,
    createdAt: input.timestamp,
    lastSeenAt: input.timestamp,
    lastIp: input.ip,
    revokedAt: null,
  }
}

export function isActiveDevice(device: Device): boolean {
  return device.revokedAt === null
}

/** Revocar dos veces es idempotente y conserva la fecha original. */
export function revokeDevice(device: Device, timestamp: string): Device {
  if (device.revokedAt !== null) return device
  return { ...device, revokedAt: timestamp }
}

export function markDeviceSeen(device: Device, timestamp: string, ip: string | null): Device {
  return { ...device, lastSeenAt: timestamp, lastIp: ip ?? device.lastIp }
}

export function toPublicDevice(device: Device): PublicDevice {
  return {
    id: device.id,
    name: device.name,
    createdAt: device.createdAt,
    lastSeenAt: device.lastSeenAt,
    lastIp: device.lastIp,
    revokedAt: device.revokedAt,
  }
}
