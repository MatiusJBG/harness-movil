import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir, type NetworkInterfaceInfo } from 'node:os'
import { join } from 'node:path'
import type { AppSettings } from '../application/ports/settings.js'
import { ConfigError } from './errors.js'
import { isLegacyV1, migrateLegacyV1 } from './legacy-v1.js'
import { resolveNetwork } from './network.js'
import { dataPaths, defaultDataDir } from './paths.js'
import { ConfigSchema, formatIssues, SCHEMA_VERSION, type AppConfig } from './schema.js'

type InterfaceLike = Record<string, NetworkInterfaceInfo[] | undefined>

export interface LoadSettingsOptions {
  readonly dataDir?: string
  readonly env?: NodeJS.ProcessEnv
  /** No escribe nada (migración en seco para `--check-config`). */
  readonly readOnly?: boolean
  readonly interfaces?: InterfaceLike
}

export interface LoadedSettings {
  readonly settings: AppSettings
  readonly config: AppConfig
  readonly migrated: boolean
  readonly backupFile: string | null
}

interface RawConfigFile {
  readonly text: string | null
  readonly raw: unknown
}

/**
 * Carga la configuración, migra v1 → v2 con backup y devuelve *slices*: cada
 * consumidor recibe solo los ajustes que necesita.
 */
export async function loadSettings(options: LoadSettingsOptions = {}): Promise<LoadedSettings> {
  const env = options.env ?? process.env
  const dataDir = options.dataDir ?? defaultDataDir(env)
  await mkdir(dataDir, { recursive: true })
  const configFile = join(dataDir, 'config.json')

  const original = await readConfigFile(configFile)
  const shape = resolveConfigShape(original.raw)
  const config = validateConfig(shape.candidate)
  const settings = buildSettings({ config, dataDir, env, interfaces: options.interfaces })
  const backupFile = await persistIfNeeded({
    configFile,
    dataDir,
    text: original.text,
    config,
    migrated: shape.migrated,
    readOnly: options.readOnly === true,
  })
  return { settings, config, migrated: shape.migrated, backupFile }
}

async function readConfigFile(file: string): Promise<RawConfigFile> {
  if (!existsSync(file)) return { text: null, raw: {} }
  const text = await readFile(file, 'utf8')
  try {
    return { text, raw: JSON.parse(text) }
  } catch (error) {
    throw new ConfigError(`config.json no es JSON válido (${file}): ${(error as Error).message}`, 'config-invalid-json')
  }
}

function validateConfig(candidate: unknown): AppConfig {
  const parsed = ConfigSchema.safeParse(candidate)
  if (!parsed.success) {
    throw new ConfigError(`config.json inválido: ${formatIssues(parsed.error.issues)}`, 'config-invalid')
  }
  if (parsed.data.tls.mode === 'files' && (parsed.data.tls.certFile === null || parsed.data.tls.keyFile === null)) {
    throw new ConfigError('tls.mode "files" requiere tls.certFile y tls.keyFile.', 'config-invalid')
  }
  return parsed.data
}

function buildSettings(input: {
  config: AppConfig
  dataDir: string
  env: NodeJS.ProcessEnv
  interfaces?: InterfaceLike
}): AppSettings {
  const { config } = input
  return {
    paths: dataPaths(input.dataDir, config.harness.home ?? resolveDshHome(input.env)),
    network: resolveNetwork(config, { env: input.env, interfaces: input.interfaces }),
    harness: { ...config.harness, extraArgs: [...config.harness.extraArgs] },
    pairing: config.pairing,
    activation: config.activation,
    limits: config.limits,
    tls: config.tls,
  }
}

async function persistIfNeeded(input: {
  configFile: string
  dataDir: string
  text: string | null
  config: AppConfig
  migrated: boolean
  readOnly: boolean
}): Promise<string | null> {
  if (input.readOnly || (input.text !== null && !input.migrated)) return null
  let backupFile: string | null = null
  if (input.text !== null) {
    backupFile = join(input.dataDir, 'config.v1.json')
    if (!existsSync(backupFile)) await writeFile(backupFile, input.text, 'utf8')
  }
  await writeAtomic(input.configFile, `${JSON.stringify(input.config, null, 2)}\n`)
  return backupFile
}

interface ResolvedShape {
  readonly candidate: unknown
  readonly migrated: boolean
}

function resolveConfigShape(raw: unknown): ResolvedShape {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ConfigError('config.json debe ser un objeto JSON.', 'config-invalid')
  }
  const record = raw as Record<string, unknown>
  if ('schemaVersion' in record) {
    if (record.schemaVersion !== SCHEMA_VERSION) {
      throw new ConfigError(
        `config.json schemaVersion ${String(record.schemaVersion)} no soportado (se esperaba ${String(SCHEMA_VERSION)}).`,
        'config-unsupported-version',
      )
    }
    return { candidate: record, migrated: false }
  }
  if (isLegacyV1(record)) return { candidate: migrateLegacyV1(record), migrated: true }
  const unknown = Object.keys(record)
  if (unknown.length === 0) return { candidate: { schemaVersion: SCHEMA_VERSION }, migrated: true }
  throw new ConfigError(
    `config.json tiene claves desconocidas: ${unknown.join(', ')}. Revisá el formato en el README.`,
    'config-unknown-keys',
  )
}

function resolveDshHome(env: NodeJS.ProcessEnv): string {
  const configured = env.DSH_HOME
  if (configured !== undefined && configured.trim() !== '') return configured
  return join(homedir(), '.dsh')
}

async function writeAtomic(file: string, content: string): Promise<void> {
  const temp = `${file}.tmp`
  await writeFile(temp, content, 'utf8')
  await rename(temp, file)
}

/** Representación imprimible para `--check-config` (sin secretos). */
export function describeSettings(loaded: LoadedSettings): Record<string, unknown> {
  const { settings, config } = loaded
  return {
    schemaVersion: config.schemaVersion,
    migrated: loaded.migrated,
    backupFile: loaded.backupFile,
    dataDir: settings.paths.dataDir,
    dshHome: settings.paths.dshHome,
    network: settings.network,
    harness: settings.harness,
    pairing: settings.pairing,
    activation: settings.activation,
    limits: settings.limits,
    tls: settings.tls,
  }
}
