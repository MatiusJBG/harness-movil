import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from '../helpers/testkit.js'
import { redactFields, scrubString } from '../../src/adapters/shared/redaction.js'
import { createFileLogger } from '../../src/adapters/logging/file-logger.js'
import { createFakeClock } from '../helpers/fakes.js'
import { makeTempDir, removeTempDir } from '../helpers/fs.js'

describe('redacción de secretos', () => {
  it('oculta tokens en URLs y cookies de Harness', () => {
    expect(scrubString('GET /?token=abc123 HTTP/1.1')).toBe('GET /?token=<redacted> HTTP/1.1')
    expect(scrubString('cookie: dsh-auth-x=v1.sig; other=1')).toContain('dsh-auth-<redacted>')
    expect(scrubString('sin secretos')).toBe('sin secretos')
  })

  it('redacta claves sensibles y anida objetos', () => {
    const redacted = redactFields({
      token: 'x',
      Cookie: 'y',
      password: 'z',
      nested: { authorization: 'Bearer abc', safe: 'ok' },
      list: ['token=q', 'texto'],
    })
    expect(redacted!.token).toBe('<redacted>')
    expect(redacted!.Cookie).toBe('<redacted>')
    expect(redacted!.password).toBe('<redacted>')
    expect((redacted!.nested as Record<string, unknown>).authorization).toBe('<redacted>')
    expect((redacted!.nested as Record<string, unknown>).safe).toBe('ok')
    expect((redacted!.list as string[])[0]).toBe('token=<redacted>')
    expect(redactFields(undefined)).toBeUndefined()
  })

  it('trunca estructuras demasiado profundas', () => {
    const deep = { a: { b: { c: { d: { e: { f: 'x' } } } } } }
    const redacted = redactFields(deep)
    expect(JSON.stringify(redacted)).toContain('truncated')
  })
})

describe('logger de archivo', () => {
  it('escribe JSON con nivel, mensaje y bindings, y respeta el nivel mínimo', async () => {
    const dir = await makeTempDir('log-')
    try {
      const file = join(dir, 'bridge.log')
      const logger = createFileLogger({ file, level: 'info', console: false, clock: createFakeClock() })
      logger.debug('no debería aparecer')
      logger.info('hola', { a: 1 })
      logger.child({ component: 'test' }).warn('ojo', { token: 'secreto' })
      logger.error('falló')
      await logger.close()

      const lines = (await readFile(file, 'utf8')).trim().split('\n')
      expect(lines).toHaveLength(3)
      const first = JSON.parse(lines[0]!) as Record<string, unknown>
      expect(first.level).toBe('info')
      expect(first.msg).toBe('hola')
      expect(first.a).toBe(1)
      const second = JSON.parse(lines[1]!) as Record<string, unknown>
      expect(second.component).toBe('test')
      expect(second.level).toBe('warn')
      expect(second.token).toBe('<redacted>')
      expect(lines.join('\n')).not.toContain('no debería aparecer')
    } finally {
      await removeTempDir(dir)
    }
  })

  it('no falla al cerrar sin archivo', async () => {
    const logger = createFileLogger({ console: false, clock: createFakeClock() })
    logger.info('solo consola desactivada')
    await logger.close()
    await logger.close()
  })
})
