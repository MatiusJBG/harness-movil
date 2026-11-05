import { describe, expect, it } from '../helpers/testkit.js'
import { DEFAULT_DEVICE_NAME, sanitizeDeviceName } from '../../src/domain/device/device-name.js'

describe('nombre de dispositivo', () => {
  it('recorta, limpia caracteres de control y limita la longitud', () => {
    expect(sanitizeDeviceName('  Pixel 8  ')).toBe('Pixel 8')
    expect(sanitizeDeviceName('Pixel\u0000\u001f 8')).toBe('Pixel 8')
    expect(sanitizeDeviceName('x'.repeat(120)).length).toBe(60)
  })

  it('usa el reemplazo cuando no hay nombre utilizable', () => {
    expect(sanitizeDeviceName('   ')).toBe(DEFAULT_DEVICE_NAME)
    expect(sanitizeDeviceName(null)).toBe(DEFAULT_DEVICE_NAME)
    expect(sanitizeDeviceName(42)).toBe(DEFAULT_DEVICE_NAME)
    expect(sanitizeDeviceName('\u0007')).toBe(DEFAULT_DEVICE_NAME)
  })
})
