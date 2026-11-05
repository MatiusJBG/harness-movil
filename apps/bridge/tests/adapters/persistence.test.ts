import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from '../helpers/testkit.js'
import { JsonDeviceRepository } from '../../src/adapters/persistence/json-device-repository.js'
import { createDevice } from '../../src/domain/device/device.js'
import { createFakeClock } from '../helpers/fakes.js'
import { makeTempDir, removeTempDir } from '../helpers/fs.js'

async function withRepo<T>(
  run: (repo: JsonDeviceRepository, file: string, clock: ReturnType<typeof createFakeClock>) => Promise<T>,
  options: { persistIntervalMs?: number } = {},
): Promise<T> {
  const dir = await makeTempDir('repo-')
  try {
    const clock = createFakeClock()
    const file = join(dir, 'devices.json')
    const repo = new JsonDeviceRepository({ file, clock, persistIntervalMs: options.persistIntervalMs ?? 0 })
    await repo.load()
    return await run(repo, file, clock)
  } finally {
    await removeTempDir(dir)
  }
}

function device(id: string) {
  return createDevice({
    id,
    name: `Equipo ${id}`,
    tokenHash: `sha:secret-${id}`,
    ip: '192.168.1.20',
    timestamp: new Date(1_700_000_000_000).toISOString(),
  })
}

describe('repositorio JSON de dispositivos', () => {
  it('persiste altas y las recupera en una instancia nueva', async () => {
    await withRepo(async (repo, file) => {
      expect(repo.activeCount()).toBe(0)
      await repo.add(device('a'))
      await repo.add(device('b'))
      expect(repo.activeCount()).toBe(2)
      expect(repo.find('a')?.name).toBe('Equipo a')
      const raw = JSON.parse(await readFile(file, 'utf8')) as { version: number; devices: unknown[] }
      expect(raw.version).toBe(1)
      expect(raw.devices).toHaveLength(2)

      const reloaded = new JsonDeviceRepository({ file, clock: createFakeClock() })
      await reloaded.load()
      expect(reloaded.list()).toHaveLength(2)
      expect(reloaded.find('b')?.tokenHash).toBe('sha:secret-b')
    })
  })

  it('revoca un dispositivo y es idempotente', async () => {
    await withRepo(async (repo) => {
      await repo.add(device('a'))
      expect(await repo.revoke('a', '2026-02-01T00:00:00.000Z')).toBe(true)
      expect(await repo.revoke('a', '2026-02-02T00:00:00.000Z')).toBe(false)
      expect(repo.find('a')?.revokedAt).toBe('2026-02-01T00:00:00.000Z')
      expect(repo.activeCount()).toBe(0)
    })
  })

  it('revoca todos y cuenta solo los activos', async () => {
    await withRepo(async (repo) => {
      await repo.add(device('a'))
      await repo.add(device('b'))
      await repo.revoke('a', '2026-01-01T00:00:00.000Z')
      expect(await repo.revokeAll('2026-03-01T00:00:00.000Z')).toBe(1)
      expect(repo.activeCount()).toBe(0)
      expect(repo.list().every((entry) => entry.revokedAt !== null)).toBe(true)
    })
  })

  it('persiste la última actividad de forma diferida', async () => {
    await withRepo(async (repo, file, clock) => {
      await repo.add(device('a'))
      const seen = repo.find('a')!
      clock.advance(5_000)
      repo.update({ ...seen, lastSeenAt: new Date(clock.nowMs()).toISOString(), lastIp: '10.0.0.9' })
      await new Promise((resolve) => setTimeout(resolve, 30))
      const raw = JSON.parse(await readFile(file, 'utf8')) as { devices: Array<{ lastIp: string }> }
      expect(raw.devices[0]!.lastIp).toBe('10.0.0.9')
    })
  })

  it('rechaza archivos con formato desconocido y filtra registros inválidos', async () => {
    const dir = await makeTempDir('repo-')
    try {
      const file = join(dir, 'devices.json')
      await writeFile(file, JSON.stringify({ version: 2, devices: [] }), 'utf8')
      const repo = new JsonDeviceRepository({ file, clock: createFakeClock() })
      await expect(repo.load()).rejects.toThrow('formato desconocido')

      await writeFile(file, JSON.stringify({ version: 1, devices: [{ id: 'x' }, { id: 'y', tokenHash: 'h' }] }), 'utf8')
      const partial = new JsonDeviceRepository({ file, clock: createFakeClock() })
      await partial.load()
      expect(partial.list()).toHaveLength(1)
      expect(partial.list()[0]!.id).toBe('y')
    } finally {
      await removeTempDir(dir)
    }
  })

  it('tolera un archivo vacío o inexistente', async () => {
    const dir = await makeTempDir('repo-')
    try {
      const file = join(dir, 'devices.json')
      const missing = new JsonDeviceRepository({ file, clock: createFakeClock() })
      await missing.load()
      expect(missing.list()).toHaveLength(0)

      await writeFile(file, '   \n', 'utf8')
      const empty = new JsonDeviceRepository({ file, clock: createFakeClock() })
      await empty.load()
      expect(empty.list()).toHaveLength(0)
    } finally {
      await removeTempDir(dir)
    }
  })
})
