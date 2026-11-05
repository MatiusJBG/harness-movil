import { afterEach, describe, expect, it } from './helpers/testkit.js'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createLogger, redactFields, scrubString } from '../src/log.js'
import { makeTempDir, removeTempDir } from './helpers/fs.js'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(removeTempDir))
})

describe('scrubString', () => {
  it('redacts tokens, cookies and signed cookies', () => {
    expect(scrubString('url?token=abc123&x=1')).toContain('token=<redacted>')
    expect(scrubString('url?token=abc123&x=1')).not.toContain('abc123')
    expect(scrubString('cookie: dsh-auth-abc=def')).toBe('cookie: dsh-auth-<redacted>')
    expect(scrubString('authorization=Bearer xyz')).toContain('<redacted>')
  })
})

describe('redactFields', () => {
  it('redacts secret keys recursively', () => {
    expect(
      redactFields({
        cookie: 'x',
        nested: { token: 'y', normal: 'ok' },
        list: ['secret=1', 3],
      }),
    ).toEqual({
      cookie: '<redacted>',
      nested: { token: '<redacted>', normal: 'ok' },
      list: ['secret=<redacted>', 3],
    })
  })

  it('truncates deep structures instead of recursing forever', () => {
    const deep = { a: { b: { c: { d: { e: { f: 1 } } } } } }
    const result = redactFields(deep)
    expect(JSON.stringify(result)).toContain('truncated')
  })
})

describe('createLogger', () => {
  it('writes JSON lines and respects the level', async () => {
    const dir = await makeTempDir('log-')
    dirs.push(dir)
    const file = join(dir, 'bridge.log')
    const logger = createLogger({ file, console: false, level: 'info' })
    logger.debug('hidden')
    logger.info('visible', { port: 1 })
    logger.child({ component: 'x' }).warn('child', { token: 'abc' })
    await logger.close()

    const lines = (await readFile(file, 'utf8')).trim().split('\n')
    expect(lines).toHaveLength(2)
    const first = JSON.parse(lines[0]!) as { msg: string; level: string; port: number }
    expect(first.msg).toBe('visible')
    expect(first.port).toBe(1)
    const second = JSON.parse(lines[1]!) as { msg: string; level: string; token: string; component: string }
    expect(second.level).toBe('warn')
    expect(second.component).toBe('x')
    expect(second.token).toBe('<redacted>')
  })

  it('survives console-only operation and close without a stream', async () => {
    const logger = createLogger({ console: false })
    logger.info('hola')
    await logger.close()
    await logger.close()
  })
})
