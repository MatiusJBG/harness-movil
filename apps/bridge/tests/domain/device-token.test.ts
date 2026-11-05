import { describe, expect, it } from '../helpers/testkit.js'
import { formatDeviceToken, parseDeviceToken } from '../../src/domain/device/device-token.js'

describe('token de dispositivo', () => {
  it('separa identificador y secreto', () => {
    expect(parseDeviceToken('a1b2.c3d4')).toEqual({ id: 'a1b2', secret: 'c3d4' })
    expect(formatDeviceToken('a1b2', 'c3d4')).toBe('a1b2.c3d4')
  })

  it('rechaza formatos inválidos', () => {
    expect(parseDeviceToken(null)).toBeNull()
    expect(parseDeviceToken(undefined)).toBeNull()
    expect(parseDeviceToken('')).toBeNull()
    expect(parseDeviceToken('sinpunto')).toBeNull()
    expect(parseDeviceToken('.secreto')).toBeNull()
    expect(parseDeviceToken('id.')).toBeNull()
  })

  it('conserva puntos internos del secreto', () => {
    expect(parseDeviceToken('id.a.b.c')).toEqual({ id: 'id', secret: 'a.b.c' })
  })
})
