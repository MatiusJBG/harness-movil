import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { isIP } from 'node:net'
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'

export const DEFAULT_PROFILE = 'mobile'
const DEFAULT_PORT = 8443

const ListenSchema = z
  .object({
    /** `auto` resolves the first non-loopback IPv4 of a physical interface. */
    host: z.string().min(1).default('auto'),
    port: z.number().int().min(1).max(65_535).default(DEFAULT_PORT),
    /** Loopback-only admin listener. Defaults to `port + 1`. */
    adminPort: z.number().int().min(1).max(65_535).optional(),
  })
  .strict()
  .default({})

const DshSchema = z
  .object({
    /** `auto` probes PATH, then the bundled Desktop CLI. */
    command: z.string().min(1).default('auto'),
    profile: z.string().min(1).default(DEFAULT_PROFILE),
    /** Null means `$DSH_HOME`, then `~/.dsh`. */
    home: z.string().min(1).nullable().default(null),
    /**
     * `isolated` gives the mobile host its own session log directory, so it never
     * fights the desktop app for the one-writer lock of a live session.
     * `shared` reuses `$DSH_HOME/sessions` and requires closing a session in the
     * desktop app before opening it on the phone.
     */
    sessions: z.enum(['isolated', 'shared']).default('isolated'),
    extraArgs: z.array(z.string()).default([]),
    startTimeoutMs: z.number().int().min(5_000).max(300_000).default(90_000),
  })
  .strict()
  .default({})

const TlsSchema = z
  .object({
    mode: z.enum(['local-ca', 'files']).default('local-ca'),
    certFile: z.string().min(1).nullable().default(null),
    keyFile: z.string().min(1).nullable().default(null),
    caFile: z.string().min(1).nullable().default(null),
  })
  .strict()
  .default({})

const PairingSchema = z
  .object({
    codeTtlSeconds: z.number().int().min(30).max(3_600).default(300),
    maxDevices: z.number().int().min(1).max(20).default(3),
  })
  .strict()
  .default({})

const ActivationSchema = z
  .object({
    autoStart: z.boolean().default(false),
    /** 0 disables the idle shutoff. */
    idleAutoOffMinutes: z.number().int().min(0).max(720).default(30),
  })
  .strict()
  .default({})

const LimitsSchema = z
  .object({
    pairingPerMinute: z.number().int().min(1).max(120).default(10),
    /** Dashboard JSON bodies only; proxied Harness traffic streams unbuffered. */
    maxBodyBytes: z.number().int().min(1_024).max(16_777_216).default(1_048_576),
  })
  .strict()
  .default({})

export const ConfigSchema = z
  .object({
    listen: ListenSchema,
    dsh: DshSchema,
    tls: TlsSchema,
    pairing: PairingSchema,
    activation: ActivationSchema,
    limits: LimitsSchema,
    /** Optional DNS name advertised in the certificate and URLs. */
    publicHost: z.string().min(1).nullable().default(null),
  })
  .strict()

export type AppConfig = z.infer<typeof ConfigSchema>

export interface ResolvedConfig {
  dataDir: string
  configFile: string
  tlsDir: string
  devicesFile: string
  logDir: string
  dshHome: string
  bindHost: string
  lanHost: string
  publicHost: string
  port: number
  adminPort: number
  authority: string
  adminAuthority: string
  publicUrl: string
  adminUrl: string
  config: AppConfig
}

export class ConfigError extends Error {
  override name = 'ConfigError'
}

export function defaultDataDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.HARNESS_MOVIL_DATA_DIR && env.HARNESS_MOVIL_DATA_DIR.trim() !== '') {
    return env.HARNESS_MOVIL_DATA_DIR
  }
  const local = env.LOCALAPPDATA
  if (local && local.trim() !== '') return join(local, 'harness-movil')
  return join(homedir(), '.local', 'share', 'harness-movil')
}

export function defaultConfig(): AppConfig {
  return ConfigSchema.parse({})
}

function isPrivateLanAddress(ip: string): boolean {
  if (isIP(ip) !== 4) return false
  if (ip.startsWith('127.')) return false
  if (ip.startsWith('169.254.')) return false
  return true
}

interface InterfaceLike {
  [name: string]: NetworkInterfaceInfo[] | undefined
}

/** Prefer Wi-Fi/Ethernet over virtual adapters, then keep the OS order. */
export function pickLanAddress(
  interfaces: InterfaceLike = networkInterfaces(),
  preferred: string | null = null,
): string | null {
  const preferredOrder = ['wi-fi', 'wifi', 'wlan', 'ethernet', 'eth', 'en']
  const candidates: Array<{ ip: string; name: string; rank: number }> = []
  for (const [name, list] of Object.entries(interfaces)) {
    if (!list) continue
    const rank = preferredOrder.findIndex((token) => name.toLowerCase().includes(token))
    for (const info of list) {
      if (info.family !== 'IPv4' || info.internal) continue
      if (!isPrivateLanAddress(info.address)) continue
      candidates.push({ ip: info.address, name, rank: rank === -1 ? preferredOrder.length : rank })
    }
  }
  if (preferred && candidates.some((entry) => entry.ip === preferred)) return preferred
  candidates.sort((a, b) => a.rank - b.rank)
  return candidates[0]?.ip ?? null
}

function resolveBindHost(config: AppConfig, env: NodeJS.ProcessEnv): { bindHost: string; lanHost: string } {
  if (config.listen.host !== 'auto') {
    const literal = isIP(config.listen.host)
    if (literal === 0) {
      throw new ConfigError(
        `listen.host debe ser "auto" o una IP literal; "${config.listen.host}" no lo es.`,
      )
    }
    return { bindHost: config.listen.host, lanHost: config.listen.host }
  }
  const ip = pickLanAddress(networkInterfaces(), env.HARNESS_MOVIL_PREFERRED_IP ?? null)
  if (!ip) {
    throw new ConfigError(
      'No se encontró una IPv4 de LAN. Conectá la PC a Wi-Fi/Ethernet o fijá listen.host en config.json.',
    )
  }
  return { bindHost: ip, lanHost: ip }
}

function resolveAdminPort(config: AppConfig): number {
  if (config.listen.adminPort) return config.listen.adminPort
  const candidate = config.listen.port + 1
  return candidate > 65_535 ? 1 : candidate
}

export interface LoadConfigOptions {
  dataDir?: string
  env?: NodeJS.ProcessEnv
  /** Do not write a default config file. */
  readOnly?: boolean
}

export async function loadConfig(options: LoadConfigOptions = {}): Promise<ResolvedConfig> {
  const env = options.env ?? process.env
  const dataDir = options.dataDir ?? defaultDataDir(env)
  const configFile = join(dataDir, 'config.json')
  await mkdir(dataDir, { recursive: true })

  let raw: unknown = {}
  if (existsSync(configFile)) {
    let text: string
    try {
      text = await readFile(configFile, 'utf8')
    } catch (error) {
      throw new ConfigError(`No se pudo leer ${configFile}: ${(error as Error).message}`)
    }
    try {
      raw = JSON.parse(text)
    } catch (error) {
      throw new ConfigError(`config.json no es JSON válido (${configFile}): ${(error as Error).message}`)
    }
  } else if (!options.readOnly) {
    await writeFile(configFile, `${JSON.stringify(defaultConfig(), null, 2)}\n`, 'utf8')
  }

  const parsed = ConfigSchema.safeParse(raw)
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ')
    throw new ConfigError(`config.json inválido: ${detail}`)
  }
  const config = parsed.data

  if (config.tls.mode === 'files' && (!config.tls.certFile || !config.tls.keyFile)) {
    throw new ConfigError('tls.mode "files" requiere tls.certFile y tls.keyFile.')
  }

  const { bindHost, lanHost } = resolveBindHost(config, env)
  const port = config.listen.port
  const adminPort = resolveAdminPort(config)
  const publicHost = config.publicHost ?? lanHost
  const authority = `${publicHost}:${port}`
  const adminAuthority = `127.0.0.1:${adminPort}`
  const dshHome =
    config.dsh.home ??
    (env.DSH_HOME && env.DSH_HOME.trim() !== '' ? env.DSH_HOME : join(homedir(), '.dsh'))

  return {
    dataDir,
    configFile,
    tlsDir: join(dataDir, 'tls'),
    devicesFile: join(dataDir, 'devices.json'),
    logDir: join(dataDir, 'logs'),
    dshHome,
    bindHost,
    lanHost,
    publicHost,
    port,
    adminPort,
    authority,
    adminAuthority,
    publicUrl: `https://${authority}/`,
    adminUrl: `http://${adminAuthority}/_hm/`,
    config,
  }
}
