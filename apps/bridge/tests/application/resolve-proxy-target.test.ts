import { describe, expect, it } from '../helpers/testkit.js'
import { resolveProxyTarget } from '../../src/application/use-cases/resolve-proxy-target.js'
import { createActivationReader, createDeviceRecord } from '../helpers/fakes.js'

const phone = createDeviceRecord('device-1')

describe('decisión de proxy', () => {
  it('permite con dispositivo emparejado y conexión activa', () => {
    expect(resolveProxyTarget({ device: phone, admin: false, activation: createActivationReader('active').snapshot() })).toEqual({
      kind: 'allow',
      port: 5173,
    })
  })

  it('permite al panel admin sin cookie', () => {
    expect(resolveProxyTarget({ device: null, admin: true, activation: createActivationReader('active').snapshot() })).toEqual({
      kind: 'allow',
      port: 5173,
    })
  })

  it('rechaza dispositivo no emparejado', () => {
    expect(resolveProxyTarget({ device: null, admin: false, activation: createActivationReader('active').snapshot() })).toEqual({
      kind: 'deny',
      reason: 'unpaired',
    })
  })

  it('rechaza conexión desactivada', () => {
    expect(resolveProxyTarget({ device: phone, admin: false, activation: createActivationReader('inactive').snapshot() })).toEqual({
      kind: 'deny',
      reason: 'inactive',
    })
    expect(resolveProxyTarget({ device: phone, admin: false, activation: createActivationReader('error').snapshot() })).toEqual({
      kind: 'deny',
      reason: 'inactive',
    })
  })

  it('distingue arranque en curso', () => {
    expect(resolveProxyTarget({ device: phone, admin: false, activation: createActivationReader('starting').snapshot() })).toEqual({
      kind: 'deny',
      reason: 'starting',
    })
  })

  it('rechaza activo sin puerto (estado inconsistente)', () => {
    const activation = createActivationReader('active', { port: null }).snapshot()
    expect(resolveProxyTarget({ device: phone, admin: false, activation })).toEqual({ kind: 'deny', reason: 'starting' })
  })
})
