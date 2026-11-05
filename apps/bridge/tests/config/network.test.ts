import { describe, expect, it } from '../helpers/testkit.js'
import { pickLanAddress, resolveNetwork } from '../../src/config/network.js'
import { ConfigError } from '../../src/config/errors.js'
import { ConfigSchema } from '../../src/config/schema.js'
import { createFakeInterfaces } from '../helpers/fakes.js'

function configWith(server: Record<string, unknown>): ReturnType<typeof ConfigSchema.parse> {
  return ConfigSchema.parse({ schemaVersion: 2, server })
}

function iface(address: string, internal = false): { address: string; netmask: string; family: string; mac: string; internal: boolean; cidr: string } {
  return { address, netmask: '255.255.255.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal, cidr: `${address}/24` }
}

describe('resolución de red', () => {
  it('prefiere Wi-Fi sobre adaptadores virtuales', () => {
    const picked = pickLanAddress({
      'vEthernet (WSL)': [iface('172.20.0.1')],
      'Wi-Fi': [iface('192.168.1.50')],
    } as never)
    expect(picked).toBe('192.168.1.50')
  })

  it('ignora loopback, link-local y no IPv4', () => {
    const picked = pickLanAddress({
      Loopback: [iface('127.0.0.1')],
      LinkLocal: [iface('169.254.10.10')],
      'Wi-Fi': [iface('192.168.1.50')],
    } as never)
    expect(picked).toBe('192.168.1.50')
    expect(pickLanAddress({ 'Wi-Fi': [iface('127.0.0.1')] } as never)).toBeNull()
  })

  it('respeta la IP preferida si está disponible', () => {
    const interfaces = { 'Wi-Fi': [iface('192.168.1.50')], Ethernet: [iface('10.0.0.7')] } as never
    expect(pickLanAddress(interfaces, '10.0.0.7')).toBe('10.0.0.7')
    expect(pickLanAddress(interfaces, '10.9.9.9')).toBe('192.168.1.50')
  })

  it('resuelve auto, puerto admin por defecto y URLs', () => {
    const network = resolveNetwork(configWith({}), { env: {}, interfaces: createFakeInterfaces() })
    expect(network.lanHost).toBe('192.168.1.50')
    expect(network.bindHost).toBe('192.168.1.50')
    expect(network.port).toBe(8443)
    expect(network.adminPort).toBe(8444)
    expect(network.publicUrl).toBe('https://192.168.1.50:8443/')
    expect(network.adminUrl).toBe('http://127.0.0.1:8444/_hm/')
  })

  it('acepta IP literal y publicHost', () => {
    const network = resolveNetwork(configWith({ lan: { host: '10.0.0.7', port: 9000 }, publicHost: 'pc.local' }), {
      env: {},
      interfaces: createFakeInterfaces(),
    })
    expect(network.lanHost).toBe('10.0.0.7')
    expect(network.authority).toBe('pc.local:9000')
    expect(network.publicUrl).toBe('https://pc.local:9000/')
  })

  it('rechaza host inválido y ausencia de LAN', () => {
    expect(() => resolveNetwork(configWith({ lan: { host: 'pc.local' } }), { env: {}, interfaces: createFakeInterfaces() })).toThrow(
      ConfigError,
    )
    expect(() => resolveNetwork(configWith({}), { env: {}, interfaces: {} })).toThrow('IPv4 de LAN')
  })
})
