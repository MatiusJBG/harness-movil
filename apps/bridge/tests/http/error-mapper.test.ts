import { describe, expect, it } from '../helpers/testkit.js'
import { mapError } from '../../src/adapters/http/presenters/error-mapper.js'
import { DomainError } from '../../src/domain/shared/domain-error.js'
import { DeviceNotFoundError } from '../../src/application/errors.js'

describe('mapper de errores HTTP', () => {
  it('traduce un DomainError a 400 con su código', () => {
    const mapped = mapError(new DomainError('identificador vacío', 'device-id-empty'))
    expect(mapped.status).toBe(400)
    expect(mapped.code).toBe('device-id-empty')
    expect(mapped.message).toBe('identificador vacío')
    expect(mapped.expected).toBe(true)
  })

  it('conserva las ramas de aplicación y el 500 genérico', () => {
    expect(mapError(new DeviceNotFoundError()).status).toBe(404)
    const unknown = mapError(new Error('falló algo interno'))
    expect(unknown.status).toBe(500)
    expect(unknown.expected).toBe(false)
  })
})
