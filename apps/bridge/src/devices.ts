import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface DeviceRecord {
  id: string
  name: string
  tokenHash: string
  createdAt: string
  lastSeenAt: string
  lastIp: string | null
  revokedAt: string | null
}

export interface PublicDevice {
  id: string
  name: string
  createdAt: string
  lastSeenAt: string
  lastIp: string | null
  revokedAt: string | null
}

export class DeviceLimitError extends Error {
  override name = 'DeviceLimitError'
}

const MAX_NAME_LENGTH = 60
const PERSIST_INTERVAL_MS = 60_000

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
  } catch {
    return false
  }
}

export function sanitizeDeviceName(input: unknown): string {
  const text = typeof input === 'string' ? input.trim() : ''
  const cleaned = text.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, MAX_NAME_LENGTH)
  return cleaned === '' ? 'Dispositivo' : cleaned
}

export class DeviceStore {
  private records: DeviceRecord[] = []
  private loaded = false
  private lastPersistAt = 0
  private persistChain: Promise<void> = Promise.resolve()

  constructor(
    private readonly file: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async load(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    if (!existsSync(this.file)) {
      this.records = []
      return
    }
    const text = await readFile(this.file, 'utf8')
    if (text.trim() === '') {
      this.records = []
      return
    }
    const parsed = JSON.parse(text) as { version?: number; devices?: DeviceRecord[] }
    if (parsed.version !== 1 || !Array.isArray(parsed.devices)) {
      throw new Error(`devices.json con formato desconocido: ${this.file}`)
    }
    this.records = parsed.devices.filter(
      (record) => typeof record.id === 'string' && typeof record.tokenHash === 'string',
    )
  }

  list(): PublicDevice[] {
    return this.records.map(toPublic)
  }

  activeCount(): number {
    return this.records.filter((record) => record.revokedAt === null).length
  }

  find(id: string): PublicDevice | null {
    const record = this.records.find((entry) => entry.id === id)
    return record ? toPublic(record) : null
  }

  async add(input: { name: string; ip: string | null; maxDevices: number }): Promise<{ device: PublicDevice; token: string }> {
    if (this.activeCount() >= input.maxDevices) {
      throw new DeviceLimitError(
        `Ya hay ${input.maxDevices} dispositivos activos. Revocá uno desde el panel antes de emparejar otro.`,
      )
    }
    const id = randomBytes(8).toString('hex')
    const secret = randomBytes(32).toString('base64url')
    const timestamp = this.now().toISOString()
    const record: DeviceRecord = {
      id,
      name: sanitizeDeviceName(input.name),
      tokenHash: hashSecret(secret),
      createdAt: timestamp,
      lastSeenAt: timestamp,
      lastIp: input.ip,
      revokedAt: null,
    }
    this.records.push(record)
    await this.persist(true)
    return { device: toPublic(record), token: `${id}.${secret}` }
  }

  /** Returns the device when the token is valid and the device is not revoked. */
  authenticate(token: string | null | undefined, ip?: string | null): PublicDevice | null {
    if (!token) return null
    const separator = token.indexOf('.')
    if (separator <= 0) return null
    const id = token.slice(0, separator)
    const secret = token.slice(separator + 1)
    if (secret === '') return null
    const record = this.records.find((entry) => entry.id === id)
    if (!record || record.revokedAt !== null) return null
    if (!safeEqualHex(record.tokenHash, hashSecret(secret))) return null
    record.lastSeenAt = this.now().toISOString()
    if (ip) record.lastIp = ip
    void this.persist(false).catch(() => undefined)
    return toPublic(record)
  }

  async revoke(id: string): Promise<boolean> {
    const record = this.records.find((entry) => entry.id === id)
    if (!record || record.revokedAt !== null) return false
    record.revokedAt = this.now().toISOString()
    await this.persist(true)
    return true
  }

  async revokeAll(): Promise<number> {
    const timestamp = this.now().toISOString()
    let count = 0
    for (const record of this.records) {
      if (record.revokedAt === null) {
        record.revokedAt = timestamp
        count += 1
      }
    }
    if (count > 0) await this.persist(true)
    return count
  }

  private async persist(force: boolean): Promise<void> {
    const nowMs = this.now().getTime()
    if (!force && nowMs - this.lastPersistAt < PERSIST_INTERVAL_MS) return
    this.lastPersistAt = nowMs
    this.persistChain = this.persistChain
      .catch(() => undefined)
      .then(async () => {
        await mkdir(dirname(this.file), { recursive: true })
        const payload = JSON.stringify({ version: 1, devices: this.records }, null, 2)
        const temp = `${this.file}.tmp`
        await writeFile(temp, `${payload}\n`, 'utf8')
        await rename(temp, this.file)
      })
    await this.persistChain
  }
}

function toPublic(record: DeviceRecord): PublicDevice {
  return {
    id: record.id,
    name: record.name,
    createdAt: record.createdAt,
    lastSeenAt: record.lastSeenAt,
    lastIp: record.lastIp,
    revokedAt: record.revokedAt,
  }
}
