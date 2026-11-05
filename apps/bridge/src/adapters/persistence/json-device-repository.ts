import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createDevice, isActiveDevice, revokeDevice, type Device } from '../../domain/device/device.js'
import type { Clock } from '../../application/ports/clock.js'
import type { DeviceRepository } from '../../application/ports/device-repository.js'

const DEFAULT_PERSIST_INTERVAL_MS = 60_000

export interface JsonDeviceRepositoryOptions {
  readonly file: string
  readonly clock: Clock
  /** Los tests lo acortan para observar la persistencia diferida. */
  readonly persistIntervalMs?: number
}

/**
 * Registro de dispositivos en `devices.json` (formato v1, solo hashes).
 * La escritura es atómica (tmp + rename) y las actualizaciones de "visto por
 * última vez" se agrupan para no escribir en cada pedido.
 */
export class JsonDeviceRepository implements DeviceRepository {
  private records: Device[] = []
  private loaded = false
  private lastPersistAt = 0
  private persistChain: Promise<void> = Promise.resolve()
  private readonly persistIntervalMs: number

  constructor(private readonly options: JsonDeviceRepositoryOptions) {
    this.persistIntervalMs = options.persistIntervalMs ?? DEFAULT_PERSIST_INTERVAL_MS
  }

  async load(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    const file = this.options.file
    if (!existsSync(file)) {
      this.records = []
      return
    }
    const text = await readFile(file, 'utf8')
    if (text.trim() === '') {
      this.records = []
      return
    }
    const parsed: unknown = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object') throw new Error(`devices.json con formato desconocido: ${file}`)
    const envelope = parsed as { version?: unknown; devices?: unknown }
    if (envelope.version !== 1 || !Array.isArray(envelope.devices)) {
      throw new Error(`devices.json con formato desconocido: ${file}`)
    }
    const fallback = this.options.clock.now().toISOString()
    this.records = envelope.devices
      .map((entry) => parseRecord(entry, fallback))
      .filter((entry): entry is Device => entry !== null)
  }

  list(): Device[] {
    return [...this.records]
  }

  activeCount(): number {
    return this.records.filter(isActiveDevice).length
  }

  find(id: string): Device | null {
    return this.records.find((entry) => entry.id === id) ?? null
  }

  async add(device: Device): Promise<void> {
    this.records.push(device)
    await this.persist(true)
  }

  update(device: Device): void {
    const index = this.records.findIndex((entry) => entry.id === device.id)
    if (index < 0) return
    this.records[index] = device
    void this.persist(false).catch(() => undefined)
  }

  async revoke(id: string, timestamp: string): Promise<boolean> {
    const index = this.records.findIndex((entry) => entry.id === id && isActiveDevice(entry))
    if (index < 0) return false
    const record = this.records[index]
    if (record === undefined) return false
    this.records[index] = revokeDevice(record, timestamp)
    await this.persist(true)
    return true
  }

  async revokeAll(timestamp: string): Promise<number> {
    let count = 0
    for (let index = 0; index < this.records.length; index += 1) {
      const record = this.records[index]
      if (record === undefined || !isActiveDevice(record)) continue
      this.records[index] = revokeDevice(record, timestamp)
      count += 1
    }
    if (count > 0) await this.persist(true)
    return count
  }

  private async persist(force: boolean): Promise<void> {
    const nowMs = this.options.clock.nowMs()
    if (!force && nowMs - this.lastPersistAt < this.persistIntervalMs) return
    this.lastPersistAt = nowMs
    this.persistChain = this.persistChain
      .catch(() => undefined)
      .then(async () => {
        await mkdir(dirname(this.options.file), { recursive: true })
        const payload = JSON.stringify({ version: 1, devices: this.records }, null, 2)
        const temp = `${this.options.file}.tmp`
        await writeFile(temp, `${payload}\n`, 'utf8')
        await rename(temp, this.options.file)
      })
    await this.persistChain
  }
}

function parseRecord(value: unknown, fallbackTimestamp: string): Device | null {
  if (value === null || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (typeof raw.id !== 'string' || typeof raw.tokenHash !== 'string') return null
  const createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : fallbackTimestamp
  const created = createDevice({
    id: raw.id,
    name: raw.name,
    tokenHash: raw.tokenHash,
    ip: typeof raw.lastIp === 'string' ? raw.lastIp : null,
    timestamp: createdAt,
  })
  return {
    ...created,
    lastSeenAt: typeof raw.lastSeenAt === 'string' ? raw.lastSeenAt : createdAt,
    revokedAt: typeof raw.revokedAt === 'string' ? raw.revokedAt : null,
  }
}
