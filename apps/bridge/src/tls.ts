import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import forge from 'node-forge'

export interface TlsMaterial {
  certPem: string
  keyPem: string
  caPem: string | null
  caDer: Buffer | null
  notAfter: Date
  fingerprint: string
  sans: string[]
  reused: boolean
}

export interface EnsureTlsOptions {
  tlsDir: string
  mode: 'local-ca' | 'files'
  certFile: string | null
  keyFile: string | null
  caFile: string | null
  sans: string[]
  now?: () => Date
}

interface TlsMeta {
  sans: string[]
  notAfter: string
  createdAt: string
}

const LEAF_DAYS = 397
const CA_DAYS = 3650
const RENEW_BEFORE_MS = 7 * 24 * 60 * 60 * 1000

export async function ensureTls(options: EnsureTlsOptions): Promise<TlsMaterial> {
  const now = options.now ?? (() => new Date())
  if (options.mode === 'files') return loadFiles(options, now)
  return ensureLocalCa(options, now)
}

async function loadFiles(options: EnsureTlsOptions, now: () => Date): Promise<TlsMaterial> {
  if (!options.certFile || !options.keyFile) {
    throw new Error('tls.mode "files" requiere certFile y keyFile')
  }
  const certPem = await readFile(options.certFile, 'utf8')
  const keyPem = await readFile(options.keyFile, 'utf8')
  const caPem = options.caFile ? await readFile(options.caFile, 'utf8') : null
  const cert = forge.pki.certificateFromPem(certPem)
  const notAfter = cert.validity.notAfter
  if (notAfter.getTime() <= now().getTime()) {
    throw new Error(`El certificado configurado ya venció: ${options.certFile}`)
  }
  return {
    certPem,
    keyPem,
    caPem,
    caDer: null,
    notAfter,
    fingerprint: fingerprintOf(cert),
    sans: options.sans,
    reused: true,
  }
}

async function ensureLocalCa(options: EnsureTlsOptions, now: () => Date): Promise<TlsMaterial> {
  const dir = options.tlsDir
  await mkdir(dir, { recursive: true })
  const paths = {
    ca: join(dir, 'ca.pem'),
    caKey: join(dir, 'ca-key.pem'),
    server: join(dir, 'server.pem'),
    serverKey: join(dir, 'server-key.pem'),
    meta: join(dir, 'meta.json'),
  }

  const required = normalizeSans(options.sans)
  const existing = await readMeta(paths.meta)

  if (
    existsSync(paths.ca) &&
    existsSync(paths.caKey) &&
    existsSync(paths.server) &&
    existsSync(paths.serverKey) &&
    existing &&
    metaCovers(existing, required, now())
  ) {
    const certPem = await readFile(paths.server, 'utf8')
    const keyPem = await readFile(paths.serverKey, 'utf8')
    const caPem = await readFile(paths.ca, 'utf8')
    const cert = forge.pki.certificateFromPem(certPem)
    return {
      certPem,
      keyPem,
      caPem,
      caDer: pemToDer(caPem),
      notAfter: cert.validity.notAfter,
      fingerprint: fingerprintOf(cert),
      sans: required,
      reused: true,
    }
  }

  const { caCert, caKeyPem, caPem } = await loadOrCreateCa(paths.ca, paths.caKey, now)
  const leaf = createLeaf(caCert, caKeyPem, required, now)

  await writeFile(paths.ca, caPem, 'utf8')
  await writeFile(paths.server, leaf.certPem, 'utf8')
  await writeFile(paths.serverKey, leaf.keyPem, 'utf8')
  const meta: TlsMeta = {
    sans: required,
    notAfter: leaf.cert.validity.notAfter.toISOString(),
    createdAt: now().toISOString(),
  }
  await writeFile(paths.meta, `${JSON.stringify(meta, null, 2)}\n`, 'utf8')

  return {
    certPem: leaf.certPem,
    keyPem: leaf.keyPem,
    caPem,
    caDer: pemToDer(caPem),
    notAfter: leaf.cert.validity.notAfter,
    fingerprint: fingerprintOf(leaf.cert),
    sans: required,
    reused: false,
  }
}

async function loadOrCreateCa(
  caPath: string,
  caKeyPath: string,
  now: () => Date,
): Promise<{ caCert: forge.pki.Certificate; caKeyPem: string; caPem: string }> {
  if (existsSync(caPath) && existsSync(caKeyPath)) {
    const caPem = await readFile(caPath, 'utf8')
    const caKeyPem = await readFile(caKeyPath, 'utf8')
    const caCert = forge.pki.certificateFromPem(caPem)
    if (caCert.validity.notAfter.getTime() > now().getTime() + RENEW_BEFORE_MS) {
      return { caCert, caKeyPem, caPem }
    }
  }

  const keys = forge.pki.rsa.generateKeyPair(2048)
  const caCert = forge.pki.createCertificate()
  caCert.publicKey = keys.publicKey
  caCert.serialNumber = randomSerial()
  caCert.validity.notBefore = new Date(now().getTime() - 24 * 60 * 60 * 1000)
  caCert.validity.notAfter = new Date(now().getTime() + CA_DAYS * 24 * 60 * 60 * 1000)
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

function createLeaf(
  caCert: forge.pki.Certificate,
  caKeyPem: string,
  sans: string[],
  now: () => Date,
): { cert: forge.pki.Certificate; certPem: string; keyPem: string } {
  const caKey = forge.pki.privateKeyFromPem(caKeyPem)
  const keys = forge.pki.rsa.generateKeyPair(2048)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = randomSerial()
  cert.validity.notBefore = new Date(now().getTime() - 24 * 60 * 60 * 1000)
  cert.validity.notAfter = new Date(now().getTime() + LEAF_DAYS * 24 * 60 * 60 * 1000)
  cert.setSubject([{ name: 'commonName', value: primaryName(sans) }])
  cert.setIssuer(caCert.subject.attributes)
  cert.setExtensions([
    { name: 'basicConstraints', cA: false, critical: true },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
    { name: 'extKeyUsage', serverAuth: true },
    { name: 'subjectAltName', altNames: alternates(sans) },
    { name: 'subjectKeyIdentifier' },
  ])
  cert.sign(caKey, forge.md.sha256.create())
  if (!caCert.verify(cert)) {
    throw new Error('El certificado del servidor no pudo verificarse contra la CA local')
  }
  return {
    cert,
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
  }
}

export function alternateFor(value: string): { type: number; ip?: string; value?: string } {
  const ip = value.includes(':') || /^\d{1,3}(\.\d{1,3}){3}$/.test(value)
  return ip ? { type: 7, ip: value } : { type: 2, value }
}

function alternates(sans: string[]): Array<{ type: number; ip?: string; value?: string }> {
  return sans.map(alternateFor)
}

export function normalizeSans(values: string[]): string[] {
  const out: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    if (trimmed === '' || out.includes(trimmed)) continue
    out.push(trimmed)
  }
  return out
}

function primaryName(sans: string[]): string {
  return sans.find((value) => !value.includes(':')) ?? sans[0] ?? '127.0.0.1'
}

function randomSerial(): string {
  const bytes = forge.random.getBytesSync(16)
  const hex = forge.util.bytesToHex(bytes)
  return hex.startsWith('0') ? `1${hex.slice(1)}` : hex
}

function fingerprintOf(cert: forge.pki.Certificate): string {
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes()
  return createHash('sha256').update(Buffer.from(der, 'binary')).digest('hex')
}

function pemToDer(pem: string): Buffer {
  const cert = forge.pki.certificateFromPem(pem)
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes()
  return Buffer.from(der, 'binary')
}

async function readMeta(file: string): Promise<TlsMeta | null> {
  if (!existsSync(file)) return null
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as TlsMeta
    if (!Array.isArray(parsed.sans) || typeof parsed.notAfter !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

function metaCovers(meta: TlsMeta, required: string[], now: Date): boolean {
  if (new Date(meta.notAfter).getTime() - now.getTime() < RENEW_BEFORE_MS) return false
  return required.every((san) => meta.sans.includes(san))
}
