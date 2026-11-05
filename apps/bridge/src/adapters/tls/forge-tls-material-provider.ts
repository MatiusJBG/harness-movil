import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import forge from 'node-forge'
import type { Clock } from '../../application/ports/clock.js'
import type { TlsMaterial, TlsMaterialProvider } from '../../application/ports/tls-material-provider.js'
import { alternateFor, coversSans, normalizeSans, primaryName } from '../../domain/tls/certificate-name.js'

const LEAF_DAYS = 397
const CA_DAYS = 3650
const RENEW_BEFORE_MS = 7 * 24 * 60 * 60 * 1_000

export interface ForgeTlsProviderOptions {
  readonly tlsDir: string
  readonly mode: 'local-ca' | 'files'
  readonly certFile: string | null
  readonly keyFile: string | null
  readonly caFile: string | null
  readonly clock: Clock
}

interface TlsMeta {
  sans: string[]
  notAfter: string
  createdAt: string
}

/** CA local + hoja firmada, o certificados externos cuando `tls.mode = files`. */
export class ForgeTlsMaterialProvider implements TlsMaterialProvider {
  constructor(private readonly options: ForgeTlsProviderOptions) {}

  async ensure(names: readonly string[]): Promise<TlsMaterial> {
    const normalized = normalizeSans(names)
    if (this.options.mode === 'files') return this.loadFiles(normalized)
    return this.ensureLocalCa(normalized)
  }

  private async loadFiles(sans: string[]): Promise<TlsMaterial> {
    const { certFile, keyFile, caFile } = this.options
    if (certFile === null || keyFile === null) {
      throw new Error('tls.mode "files" requiere certFile y keyFile')
    }
    const certPem = await readFile(certFile, 'utf8')
    const keyPem = await readFile(keyFile, 'utf8')
    const caPem = caFile === null ? null : await readFile(caFile, 'utf8')
    const cert = forge.pki.certificateFromPem(certPem)
    if (cert.validity.notAfter.getTime() <= this.options.clock.nowMs()) {
      throw new Error(`El certificado configurado ya venció: ${certFile}`)
    }
    return {
      certPem,
      keyPem,
      caPem,
      caDer: null,
      notAfter: cert.validity.notAfter,
      fingerprint: fingerprintOf(cert),
      sans,
      reused: true,
    }
  }

  private async ensureLocalCa(required: string[]): Promise<TlsMaterial> {
    const dir = this.options.tlsDir
    await mkdir(dir, { recursive: true })
    const paths = {
      ca: join(dir, 'ca.pem'),
      caKey: join(dir, 'ca-key.pem'),
      server: join(dir, 'server.pem'),
      serverKey: join(dir, 'server-key.pem'),
      meta: join(dir, 'meta.json'),
    }

    const existing = await readMeta(paths.meta)
    if (this.canReuse(paths, existing, required)) {
      const certPem = await readFile(paths.server, 'utf8')
      const caPem = await readFile(paths.ca, 'utf8')
      const cert = forge.pki.certificateFromPem(certPem)
      return {
        certPem,
        keyPem: await readFile(paths.serverKey, 'utf8'),
        caPem,
        caDer: pemToDer(caPem),
        notAfter: cert.validity.notAfter,
        fingerprint: fingerprintOf(cert),
        sans: required,
        reused: true,
      }
    }

    const ca = await this.loadOrCreateCa(paths.ca, paths.caKey)
    const leaf = createLeaf(ca.caCert, ca.caKeyPem, required, this.options.clock.now())
    await writeFile(paths.ca, ca.caPem, 'utf8')
    await writeFile(paths.server, leaf.certPem, 'utf8')
    await writeFile(paths.serverKey, leaf.keyPem, 'utf8')
    const meta: TlsMeta = {
      sans: required,
      notAfter: leaf.cert.validity.notAfter.toISOString(),
      createdAt: this.options.clock.now().toISOString(),
    }
    await writeFile(paths.meta, `${JSON.stringify(meta, null, 2)}\n`, 'utf8')
    return {
      certPem: leaf.certPem,
      keyPem: leaf.keyPem,
      caPem: ca.caPem,
      caDer: pemToDer(ca.caPem),
      notAfter: leaf.cert.validity.notAfter,
      fingerprint: fingerprintOf(leaf.cert),
      sans: required,
      reused: false,
    }
  }

  private canReuse(
    paths: { ca: string; caKey: string; server: string; serverKey: string },
    existing: TlsMeta | null,
    required: string[],
  ): boolean {
    if (existing === null) return false
    if (!existsSync(paths.ca) || !existsSync(paths.caKey) || !existsSync(paths.server) || !existsSync(paths.serverKey)) {
      return false
    }
    if (new Date(existing.notAfter).getTime() - this.options.clock.nowMs() < RENEW_BEFORE_MS) return false
    return coversSans(existing.sans, required)
  }

  private async loadOrCreateCa(
    caPath: string,
    caKeyPath: string,
  ): Promise<{ caCert: forge.pki.Certificate; caKeyPem: string; caPem: string }> {
    if (existsSync(caPath) && existsSync(caKeyPath)) {
      const caPem = await readFile(caPath, 'utf8')
      const caKeyPem = await readFile(caKeyPath, 'utf8')
      const caCert = forge.pki.certificateFromPem(caPem)
      if (caCert.validity.notAfter.getTime() > this.options.clock.nowMs() + RENEW_BEFORE_MS) {
        return { caCert, caKeyPem, caPem }
      }
    }

    const nowMs = this.options.clock.nowMs()
    const keys = forge.pki.rsa.generateKeyPair(2048)
    const caCert = forge.pki.createCertificate()
    caCert.publicKey = keys.publicKey
    caCert.serialNumber = randomSerial()
    caCert.validity.notBefore = new Date(nowMs - 24 * 60 * 60 * 1_000)
    caCert.validity.notAfter = new Date(nowMs + CA_DAYS * 24 * 60 * 60 * 1_000)
    const subject = [
      { name: 'commonName', value: 'Harness Movil Local CA' },
      { name: 'organizationName', value: 'Harness Movil' },
    ]
    caCert.setSubject(subject)
    caCert.setIssuer(subject)
    caCert.setExtensions([
      { name: 'basicConstraints', cA: true, critical: true, pathLenConstraint: 1 },
      { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
      { name: 'subjectKeyIdentifier' },
    ])
    caCert.sign(keys.privateKey, forge.md.sha256.create())

    const caPem = forge.pki.certificateToPem(caCert)
    const caKeyPem = forge.pki.privateKeyToPem(keys.privateKey)
    await writeFile(caPath, caPem, 'utf8')
    await writeFile(caKeyPath, caKeyPem, 'utf8')
    return { caCert, caKeyPem, caPem }
  }
}

function createLeaf(
  caCert: forge.pki.Certificate,
  caKeyPem: string,
  sans: string[],
  now: Date,
): { cert: forge.pki.Certificate; certPem: string; keyPem: string } {
  const caKey = forge.pki.privateKeyFromPem(caKeyPem)
  const keys = forge.pki.rsa.generateKeyPair(2048)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = randomSerial()
  cert.validity.notBefore = new Date(now.getTime() - 24 * 60 * 60 * 1_000)
  cert.validity.notAfter = new Date(now.getTime() + LEAF_DAYS * 24 * 60 * 60 * 1_000)
  cert.setSubject([{ name: 'commonName', value: primaryName(sans) }])
  cert.setIssuer(caCert.subject.attributes)
  cert.setExtensions([
    { name: 'basicConstraints', cA: false, critical: true },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
    { name: 'extKeyUsage', serverAuth: true },
    { name: 'subjectAltName', altNames: sans.map(alternateFor) },
    { name: 'subjectKeyIdentifier' },
  ])
  cert.sign(caKey, forge.md.sha256.create())
  if (!caCert.verify(cert)) {
    throw new Error('El certificado del servidor no pudo verificarse contra la CA local')
  }
  return { cert, certPem: forge.pki.certificateToPem(cert), keyPem: forge.pki.privateKeyToPem(keys.privateKey) }
}

function randomSerial(): string {
  const hex = forge.util.bytesToHex(forge.random.getBytesSync(16))
  return hex.startsWith('0') ? `1${hex.slice(1)}` : hex
}

function fingerprintOf(cert: forge.pki.Certificate): string {
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes()
  return createHash('sha256').update(Buffer.from(der, 'binary')).digest('hex')
}

function pemToDer(pem: string): Uint8Array {
  const cert = forge.pki.certificateFromPem(pem)
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes()
  return Buffer.from(der, 'binary')
}

async function readMeta(file: string): Promise<TlsMeta | null> {
  if (!existsSync(file)) return null
  try {
    const parsed: unknown = JSON.parse(await readFile(file, 'utf8'))
    if (parsed === null || typeof parsed !== 'object') return null
    const meta = parsed as { sans?: unknown; notAfter?: unknown }
    if (!Array.isArray(meta.sans) || typeof meta.notAfter !== 'string') return null
    return { sans: meta.sans.filter((entry): entry is string => typeof entry === 'string'), notAfter: meta.notAfter, createdAt: '' }
  } catch {
    return null
  }
}
