import type { NetworkInterfaceInfo } from 'node:os'
import type { ActivationReader, ActivationSnapshot } from '../../src/application/ports/activation-gateway.js'
import type { Clock } from '../../src/application/ports/clock.js'
import type { DeviceRepository } from '../../src/application/ports/device-repository.js'
import type { HarnessLaunch, HarnessSupervisor } from '../../src/application/ports/harness-supervisor.js'
import type { IdGenerator } from '../../src/application/ports/id-generator.js'
import type { Logger, LogFields, LogLevel } from '../../src/application/ports/logger.js'
import type { PairingTicketStore } from '../../src/application/ports/pairing-ticket-store.js'
import type { SecretHasher } from '../../src/application/ports/secret-hasher.js'
import type { SessionCookieStore } from '../../src/application/ports/session-cookie-store.js'
import type { ActivationState } from '../../src/domain/activation/activation-state.js'
import type { Device } from '../../src/domain/device/device.js'
import { formatPairingCode } from '../../src/domain/pairing/pairing-code.js'
import { isTicketExpired, ticketMatches, type PairingCredentialInput, type PairingTicket } from '../../src/domain/pairing/pairing-ticket.js'

export const FIXED_NOW_MS = 1_700_000_000_000

export interface FakeClock extends Clock {
  advance(ms: number): void
  set(ms: number): void
}

export function createFakeClock(startMs = FIXED_NOW_MS): FakeClock {
  let current = startMs
  return {
    now: () => new Date(current),
    nowMs: () => current,
    advance: (ms) => {
      current += ms
    },
    set: (ms) => {
      current = ms
    },
  }
}

export interface LogEntry {
  level: LogLevel
  message: string
  fields?: LogFields
}

export interface FakeLogger extends Logger {
  entries: LogEntry[]
}

export function createFakeLogger(): FakeLogger {
  const entries: LogEntry[] = []
  const make = (): FakeLogger => ({
    entries,
    debug: (message, fields) => entries.push(fields ? { level: 'debug', message, fields } : { level: 'debug', message }),
    info: (message, fields) => entries.push(fields ? { level: 'info', message, fields } : { level: 'info', message }),
    warn: (message, fields) => entries.push(fields ? { level: 'warn', message, fields } : { level: 'warn', message }),
    error: (message, fields) => entries.push(fields ? { level: 'error', message, fields } : { level: 'error', message }),
    child: () => make(),
    close: async () => undefined,
  })
  return make()
}

export function createFakeHasher(): SecretHasher {
  return {
    hash: (secret) => `sha:${secret}`,
    matches: (hash, secret) => hash === `sha:${secret}`,
  }
}

export interface FakeIds extends IdGenerator {
  readonly secrets: string[]
}

export function createFakeIds(): FakeIds {
  let deviceNumber = 0
  let secretNumber = 0
  const secrets: string[] = []
  return {
    secrets,
    deviceId: () => {
      deviceNumber += 1
      return `device-${deviceNumber}`
    },
    deviceSecret: () => {
      secretNumber += 1
      const value = `secret-${secretNumber}`
      secrets.push(value)
      return value
    },
    pairingSecret: () => 'pair-secret',
    pairingCodeValue: () => 42,
  }
}

export interface FakeDeviceRepository extends DeviceRepository {
  readonly records: Device[]
  readonly added: Device[]
  failAdd: boolean
}

export function createFakeDevices(initial: Device[] = []): FakeDeviceRepository {
  const records: Device[] = [...initial]
  const added: Device[] = []
  const repository: FakeDeviceRepository = {
    records,
    added,
    failAdd: false,
    load: async () => undefined,
    list: () => records,
    activeCount: () => records.filter((entry) => entry.revokedAt === null).length,
    find: (id) => records.find((entry) => entry.id === id) ?? null,
    add: async (device) => {
      if (repository.failAdd) throw new Error('fallo de escritura simulado')
      records.push(device)
      added.push(device)
    },
    update: (device) => {
      const index = records.findIndex((entry) => entry.id === device.id)
      if (index >= 0) records[index] = device
    },
    revoke: async (id, timestamp) => {
      const index = records.findIndex((entry) => entry.id === id && entry.revokedAt === null)
      if (index < 0) return false
      records[index] = { ...records[index]!, revokedAt: timestamp }
      return true
    },
    revokeAll: async (timestamp) => {
      let count = 0
      for (let index = 0; index < records.length; index += 1) {
        if (records[index]!.revokedAt !== null) continue
        records[index] = { ...records[index]!, revokedAt: timestamp }
        count += 1
      }
      return count
    },
  }
  return repository
}

export interface FakeTicketStore extends PairingTicketStore {
  readonly issued: PairingTicket[]
  redeemedCount: number
  ticket: PairingTicket | null
}

export function createFakeTickets(): FakeTicketStore {
  const issued: PairingTicket[] = []
  const store: FakeTicketStore = {
    issued,
    redeemedCount: 0,
    ticket: null,
    issue: (ttlMs, issuedAtMs) => {
      const ticket: PairingTicket = {
        code: formatPairingCode(42),
        secret: 'pair-secret',
        issuedAt: issuedAtMs,
        expiresAt: issuedAtMs + ttlMs,
      }
      store.ticket = ticket
      issued.push(ticket)
      return ticket
    },
    current: (nowMs) => {
      if (store.ticket !== null && isTicketExpired(store.ticket, nowMs)) store.ticket = null
      return store.ticket
    },
    redeem: (input: PairingCredentialInput, nowMs) => {
      const ticket = store.current(nowMs)
      if (ticket === null || !ticketMatches(ticket, input)) return null
      store.ticket = null
      store.redeemedCount += 1
      return ticket
    },
    clear: () => {
      store.ticket = null
    },
  }
  return store
}

export interface FakeSupervisor extends HarnessSupervisor {
  startCount: number
  stopCount: number
  failNextStart: Error | null
  running: boolean
  emitExit(last: HarnessLaunch | null): void
  readonly launch: HarnessLaunch
}

export function createFakeSupervisor(launch: HarnessLaunch = {
  pid: 4242,
  port: 5173,
  token: 'launch-token',
  startedAt: FIXED_NOW_MS,
  command: 'dsh',
}): FakeSupervisor {
  const listeners = new Set<(last: HarnessLaunch | null) => void>()
  const supervisor: FakeSupervisor = {
    launch,
    startCount: 0,
    stopCount: 0,
    failNextStart: null,
    running: false,
    start: async () => {
      supervisor.startCount += 1
      if (supervisor.failNextStart !== null) {
        const error = supervisor.failNextStart
        supervisor.failNextStart = null
        throw error
      }
      supervisor.running = true
      return supervisor.launch
    },
    stop: async () => {
      supervisor.stopCount += 1
      supervisor.running = false
    },
    isRunning: () => supervisor.running,
    onExit: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    emitExit: (last) => {
      for (const listener of listeners) listener(last)
    },
  }
  return supervisor
}

export interface FakeCookies extends SessionCookieStore {
  cookie: string | undefined
  exchangeCount: number
}

export function createFakeCookies(): FakeCookies {
  const cookies: FakeCookies = {
    cookie: undefined,
    exchangeCount: 0,
    exchange: async (input) => {
      cookies.exchangeCount += 1
      cookies.cookie = `dsh-auth-test=${input.token}`
    },
    clear: () => {
      cookies.cookie = undefined
    },
    header: () => cookies.cookie,
  }
  return cookies
}

export function createActivationReader(
  state: ActivationState = 'inactive',
  overrides: Partial<ActivationSnapshot> = {},
): ActivationReader {
  const snapshot: ActivationSnapshot = {
    state,
    active: state === 'active',
    error: null,
    port: state === 'active' ? 5173 : null,
    pid: state === 'active' ? 4242 : null,
    startedAt: state === 'active' ? FIXED_NOW_MS : null,
    lastActivityAt: state === 'active' ? FIXED_NOW_MS : null,
    ...overrides,
  }
  return {
    state: () => snapshot.state,
    snapshot: () => snapshot,
    isActive: () => snapshot.active,
  }
}

/** Interfaz de red simulada: una Wi-Fi con IPv4 privada (para resolver el host LAN). */
export function createFakeInterfaces(): Record<string, NetworkInterfaceInfo[] | undefined> {
  const wifi = {
    address: '192.168.1.50',
    netmask: '255.255.255.0',
    family: 'IPv4',
    mac: '00:00:00:00:00:00',
    internal: false,
    cidr: '192.168.1.50/24',
  } as NetworkInterfaceInfo
  return { 'Wi-Fi': [wifi] }
}

export function createDeviceRecord(id: string, overrides: Partial<Device> = {}): Device {
  return {
    id,
    name: `Dispositivo ${id}`,
    tokenHash: `sha:secret-${id}`,
    createdAt: new Date(FIXED_NOW_MS).toISOString(),
    lastSeenAt: new Date(FIXED_NOW_MS).toISOString(),
    lastIp: null,
    revokedAt: null,
    ...overrides,
  }
}
