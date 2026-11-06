import { isIP } from 'node:net'
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os'
import type { NetworkSettings } from '../application/ports/settings.js'
import { ConfigError } from './errors.js'
import type { AppConfig } from './schema.js'

type InterfaceLike = Record<string, NetworkInterfaceInfo[] | undefined>

function isPrivateLanAddress(ip: string): boolean {
  if (isIP(ip) !== 4) return false
  if (ip.startsWith('127.')) return false
  if (ip.startsWith('169.254.')) return false
  return true
}

/** Prefiere Wi-Fi/Ethernet sobre adaptadores virtuales y conserva el orden del SO. */
export function pickLanAddress(interfaces: InterfaceLike = networkInterfaces(), preferred: string | null = null): string | null {
  const preferredOrder = ['wi-fi', 'wifi', 'wlan', 'ethernet', 'eth', 'en']
  const candidates: { ip: string; rank: number }[] = []
  for (const [name, list] of Object.entries(interfaces)) {
    if (list === undefined) continue
    const rank = preferredOrder.findIndex((token) => name.toLowerCase().includes(token))
    for (const info of list) {
      if (info.family !== 'IPv4' || info.internal) continue
      if (!isPrivateLanAddress(info.address)) continue
      candidates.push({ ip: info.address, rank: rank === -1 ? preferredOrder.length : rank })
    }
  }
  if (preferred !== null && candidates.some((entry) => entry.ip === preferred)) return preferred
  candidates.sort((a, b) => a.rank - b.rank)
  return candidates[0]?.ip ?? null
}

export interface ResolveNetworkOptions {
  readonly interfaces?: InterfaceLike
  readonly env?: NodeJS.ProcessEnv
}

function resolveLanHost(config: AppConfig, interfaces: InterfaceLike, env: NodeJS.ProcessEnv): string {
  const configured = config.server.lan.host
  if (configured === 'auto') {
    const picked = pickLanAddress(interfaces, env.HARNESS_MOVIL_PREFERRED_IP ?? null)
    if (picked === null) {
      throw new ConfigError(
        'No se encontró una IPv4 de LAN. Conectá la PC a Wi-Fi/Ethernet o fijá server.lan.host en config.json.',
        'config-no-lan',
      )
    }
    return picked
  }
  if (isIP(configured) === 0) {
    throw new ConfigError(`server.lan.host debe ser "auto" o una IP literal; "${configured}" no lo es.`)
  }
  return configured
}

/** IPv6 literal entre corchetes para construir URLs/Host válidos. */
function formatAuthorityHost(host: string): string {
  return host.includes(':') ? `[${host}]` : host
}

export function resolveNetwork(config: AppConfig, options: ResolveNetworkOptions = {}): NetworkSettings {
  const env = options.env ?? process.env
  const interfaces = options.interfaces ?? networkInterfaces()
  const lanHost = resolveLanHost(config, interfaces, env)
  const port = config.server.lan.port
  const adminPort = config.server.admin.port ?? (port + 1 > 65_535 ? 1 : port + 1)
  const publicHost = config.server.publicHost ?? lanHost
  const authority = `${publicHost}:${String(port)}`
  const adminAuthority = `${formatAuthorityHost(config.server.admin.host)}:${String(adminPort)}`
  return {
    bindHost: lanHost,
    lanHost,
    publicHost,
    port,
    adminHost: config.server.admin.host,
    adminPort,
    authority,
    adminAuthority,
    publicUrl: `https://${authority}/`,
    adminUrl: `http://${adminAuthority}/_hm/`,
  }
}
