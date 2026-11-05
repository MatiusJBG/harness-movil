import { describe, expect, it } from '../helpers/testkit.js'
import { extractLaunchToken } from '../../src/domain/harness/launch-token.js'
import { sessionsRootName, usesIsolatedSessions } from '../../src/domain/harness/session-scope.js'

describe('token de lanzamiento de dsh', () => {
  it('extrae el token aunque la URL anuncie el host público', () => {
    expect(extractLaunchToken('  Host: https://192.168.0.5:8443/?token=abc.DEF-123~ ')).toBe('abc.DEF-123~')
    expect(extractLaunchToken('http://127.0.0.1:7777/?token=xyz')).toBe('xyz')
    expect(extractLaunchToken('dsh web listo en http://127.0.0.1:1/')).toBeNull()
    expect(extractLaunchToken('')).toBeNull()
  })
})

describe('ámbito de sesiones', () => {
  it('mapea isolated a su propio directorio', () => {
    expect(sessionsRootName('isolated')).toBe('sessions-mobile')
    expect(sessionsRootName('shared')).toBe('sessions')
    expect(usesIsolatedSessions('isolated')).toBe(true)
    expect(usesIsolatedSessions('shared')).toBe(false)
  })
})
