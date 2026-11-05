import { describe, expect, it } from '../helpers/testkit.js'
import { coversSans, isIpLiteral, normalizeSans, primaryName } from '../../src/domain/tls/certificate-name.js'

describe('nombres de certificado (SAN)', () => {
  it('deduplica recortando y conservando el orden', () => {
    expect(normalizeSans([' 192.168.0.5 ', 'pc', '192.168.0.5', '', 'pc.local'])).toEqual(['192.168.0.5', 'pc', 'pc.local'])
  })

  it('distingue IP de nombre DNS', () => {
    expect(isIpLiteral('192.168.0.5')).toBe(true)
    expect(isIpLiteral('::1')).toBe(true)
    expect(isIpLiteral('pc.local')).toBe(false)
    expect(isIpLiteral('no-es-ip')).toBe(false)
  })

  it('elige el primario conservando la semántica histórica (solo cosmético)', () => {
    expect(primaryName(['192.168.0.5', 'pc.local'])).toBe('192.168.0.5')
    expect(primaryName(['::1', '192.168.0.5'])).toBe('192.168.0.5')
    expect(primaryName(['::1'])).toBe('::1')
    expect(primaryName([])).toBe('127.0.0.1')
  })

  it('exige cobertura completa de los nombres requeridos', () => {
    expect(coversSans(['a', 'b'], ['a'])).toBe(true)
    expect(coversSans(['a'], ['a', 'b'])).toBe(false)
    expect(coversSans([], [])).toBe(true)
  })
})
