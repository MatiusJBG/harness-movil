import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from '../helpers/testkit.js'
import { ForgeTlsMaterialProvider } from '../../src/adapters/tls/forge-tls-material-provider.js'
import { createFakeClock } from '../helpers/fakes.js'
import { makeTempDir, removeTempDir } from '../helpers/fs.js'

async function withProvider<T>(
  run: (input: { tlsDir: string; clock: ReturnType<typeof createFakeClock>; provider: ForgeTlsMaterialProvider }) => Promise<T>,
): Promise<T> {
  const dir = await makeTempDir('tls-')
  try {
    const clock = createFakeClock()
    const tlsDir = join(dir, 'tls')
    const provider = new ForgeTlsMaterialProvider({
      tlsDir,
      mode: 'local-ca',
      certFile: null,
      keyFile: null,
      caFile: null,
      clock,
    })
    return await run({ tlsDir, clock, provider })
  } finally {
    await removeTempDir(dir)
  }
}

describe('proveedor TLS con CA local', () => {
  it('genera CA y hoja con los SAN pedidos', async () => {
    await withProvider(async ({ provider, tlsDir, clock }) => {
      const material = await provider.ensure(['192.168.1.50', 'pc.local', 'localhost'])
      expect(material.reused).toBe(false)
      expect(material.certPem).toContain('BEGIN CERTIFICATE')
      expect(material.keyPem).toContain('BEGIN')
      expect(material.caPem).toContain('BEGIN CERTIFICATE')
      expect(material.caDer).not.toBeNull()
      expect(material.caDer!.byteLength).toBeGreaterThan(0)
      expect(material.fingerprint).toMatch(/^[0-9a-f]{64}$/)
      expect([...material.sans]).toEqual(['192.168.1.50', 'pc.local', 'localhost'])
      expect(material.notAfter.getTime()).toBeGreaterThan(clock.nowMs() + 86_400_000)

      const certPem = await readFile(join(tlsDir, 'server.pem'), 'utf8')
      expect(certPem).toBe(material.certPem)
      expect(await readFile(join(tlsDir, 'ca-key.pem'), 'utf8')).toContain('PRIVATE KEY')
    })
  })

  it('reutiliza el material si los SAN y la vigencia alcanzan', async () => {
    await withProvider(async ({ provider }) => {
      const first = await provider.ensure(['127.0.0.1'])
      const second = await provider.ensure(['127.0.0.1'])
      expect(second.reused).toBe(true)
      expect(second.fingerprint).toBe(first.fingerprint)
    })
  })

  it('regenera la hoja cuando cambia el conjunto de SAN', async () => {
    await withProvider(async ({ provider, clock }) => {
      await provider.ensure(['127.0.0.1'])
      const rotated = await provider.ensure(['127.0.0.1', 'pc.local'])
      expect(rotated.reused).toBe(false)
      expect([...rotated.sans]).toContain('pc.local')
      expect(clock.nowMs()).toBeGreaterThan(0)
    })
  })

  it('regenera cuando el meta está por vencer', async () => {
    await withProvider(async ({ provider, tlsDir, clock }) => {
      await provider.ensure(['127.0.0.1'])
      const metaPath = join(tlsDir, 'meta.json')
      const meta = JSON.parse(await readFile(metaPath, 'utf8')) as { sans: string[]; notAfter: string; createdAt: string }
      await writeFile(metaPath, JSON.stringify({ ...meta, notAfter: new Date(clock.nowMs() + 86_400_000).toISOString() }), 'utf8')
      const renewed = await provider.ensure(['127.0.0.1'])
      expect(renewed.reused).toBe(false)
    })
  })

  it('usa certificados externos en modo files', async () => {
    await withProvider(async ({ provider, tlsDir, clock }) => {
      await provider.ensure(['127.0.0.1'])
      const files = new ForgeTlsMaterialProvider({
        tlsDir,
        mode: 'files',
        certFile: join(tlsDir, 'server.pem'),
        keyFile: join(tlsDir, 'server-key.pem'),
        caFile: join(tlsDir, 'ca.pem'),
        clock,
      })
      const material = await files.ensure(['127.0.0.1'])
      expect(material.reused).toBe(true)
      expect(material.caDer).toBeNull()
      expect(material.caPem).toContain('BEGIN CERTIFICATE')
      expect([...material.sans]).toEqual(['127.0.0.1'])
    })
  })

  it('falla si faltan archivos o el certificado no es válido', async () => {
    await withProvider(async ({ tlsDir, clock }) => {
      const missing = new ForgeTlsMaterialProvider({
        tlsDir,
        mode: 'files',
        certFile: null,
        keyFile: null,
        caFile: null,
        clock,
      })
      await expect(missing.ensure(['127.0.0.1'])).rejects.toThrow('requiere certFile')

      await mkdir(tlsDir, { recursive: true })
      await writeFile(join(tlsDir, 'bogus.pem'), 'no-es-un-certificado', 'utf8')
      const bogus = new ForgeTlsMaterialProvider({
        tlsDir,
        mode: 'files',
        certFile: join(tlsDir, 'bogus.pem'),
        keyFile: join(tlsDir, 'bogus.pem'),
        caFile: null,
        clock,
      })
      await expect(bogus.ensure(['127.0.0.1'])).rejects.toThrow(/./)
    })
  })
})
