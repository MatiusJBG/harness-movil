import { describe, expect, it } from '../helpers/testkit.js'
import { timingSafeEquals } from '../../src/domain/shared/timing-safe-equals.js'

describe('comparación de longitud constante', () => {
  it('compara contenido completo', () => {
    expect(timingSafeEquals('abc', 'abc')).toBe(true)
    expect(timingSafeEquals('abc', 'abd')).toBe(false)
    expect(timingSafeEquals('abc', 'ab')).toBe(false)
    expect(timingSafeEquals('', '')).toBe(true)
    expect(timingSafeEquals('a', '')).toBe(false)
  })
})
