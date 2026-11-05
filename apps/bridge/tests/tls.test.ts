import { afterEach, describe, expect, it } from './helpers/testkit.js'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import forge from 'node-forge'
import { ensureTls, normalizeSans } from '../src/tls.js'
import { makeTempDir, removeTempDir } from './helpers/fs.js'

const dirs: string[] = []

async function tlsDir(): Promise<string> {
  const dir = await makeTempDir('tls-')
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(removeTempDir))
})

describe('ensureTls', () => {
  it('creates a local CA and a verifiable leaf with the requested SANs', async () => {
    const dir = await tlsDir()
    const material = await ensureTls({
      tlsDir: dir,
      mode: 'local-ca',
      certFile: null,
      keyFile: null,
      caFile: null,
      sans: ['192.168.1.44', '127.0.0.1', 'localhost'],
    })
    expect(material.reused).toBe(false)
    expect(material.caDer?.[0]).toBe(0x30)
    expect(material.notAfter.getTime()).toBeGreaterThan(Date.now())
    expect(material.fingerprint).toMatch(/^[a-f0-9]{64}$/)

    const ca = forge.pki.certificateFromPem(material.caPem!)
    const leaf = forge.pki.certificateFromPem(material.certPem)
    expect(ca.verify(leaf)).toBe(true)
    const altNames = leaf.getExtension('subjectAltName') as { altNames?: Array<{ type: number; ip?: string; value?: string }> }
    const values = (altNames.altNames ?? []).map((entry) => entry.ip ?? entry.value)
    expect(values).toContain('192.168.1.44')
    expect(values).toContain('127.0.0.1')
    expect(values).toContain('localhost')
  })

  it('reuses the CA and rotates the leaf when SANs change', async () => {
    const dir = await tlsDir()
    const first = await ensureTls({
      tlsDir: dir,
      mode: 'local-ca',
      certFile: null,
      keyFile: null,
      caFile: null,
      sans: ['192.168.1.44'],
    })
    const second = await ensureTls({
      tlsDir: dir,
      mode: 'local-ca',
      certFile: null,
      keyFile: null,
      caFile: null,
      sans: ['192.168.1.44', '10.0.0.9'],
    })
    expect(second.reused).toBe(false)
    expect(second.caPem).toBe(first.caPem)
    expect(second.certPem).not.toBe(first.certPem)
  })

  it('reuses an existing valid leaf', async () => {
    const dir = await tlsDir()
    const options = {
      tlsDir: dir,
      mode: 'local-ca' as const,
      certFile: null,
      keyFile: null,
      caFile: null,
      sans: ['127.0.0.1'],
    }
    const first = await ensureTls(options)
    const second = await ensureTls(options)
    expect(second.reused).toBe(true)
    expect(second.fingerprint).toBe(first.fingerprint)
  })

  it('loads certificate files in files mode', async () => {
    const dir = await tlsDir()
    const generated = await ensureTls({
      tlsDir: dir,
      mode: 'local-ca',
      certFile: null,
      keyFile: null,
      caFile: null,
      sans: ['127.0.0.1'],
    })
    const certFile = join(dir, 'external-cert.pem')
    const keyFile = join(dir, 'external-key.pem')
    await import('node:fs/promises').then(async ({ writeFile }) => {
      await writeFile(certFile, generated.certPem)
      await writeFile(keyFile, generated.keyPem)
    })
    const external = await ensureTls({
      tlsDir: dir,
      mode: 'files',
      certFile,
      keyFile,
      caFile: null,
      sans: ['127.0.0.1'],
    })
    expect(external.certPem).toContain('BEGIN CERTIFICATE')
    expect(external.caDer).toBeNull()
    expect((await readFile(certFile, 'utf8')).length).toBeGreaterThan(100)
  })

  it('fails when the configured certificate is missing', async () => {
    const dir = await tlsDir()
    await expect(
      ensureTls({
        tlsDir: dir,
        mode: 'files',
        certFile: join(dir, 'missing.pem'),
        keyFile: join(dir, 'missing-key.pem'),
        caFile: null,
        sans: [],
      }),
    ).rejects.toBeTruthy()
  })
})

describe('normalizeSans', () => {
  it('trims, drops empties and deduplicates', () => {
    expect(normalizeSans([' a ', 'b', 'a', '', '  '])).toEqual(['a', 'b'])
  })
})
