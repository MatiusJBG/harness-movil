import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from '../helpers/testkit.js'

const SRC = join(process.cwd(), 'apps', 'bridge', 'src')

const FORBIDDEN_IN_INNER_LAYERS: readonly { pattern: RegExp; reason: string }[] = [
  { pattern: /from 'node:/, reason: 'las capas internas no pueden importar Node' },
  { pattern: /from 'zod'/, reason: 'zod es un detalle de la capa de configuración' },
  { pattern: /from 'http-proxy'/, reason: 'http-proxy es un adaptador HTTP' },
  { pattern: /from 'qrcode'/, reason: 'qrcode es un adaptador de presentación' },
  { pattern: /from 'node-forge'/, reason: 'node-forge es un adaptador TLS' },
  { pattern: /from '(?:\.\.\/)+(?:adapters|composition|config|cli)\//, reason: 'las capas internas no pueden mirar hacia afuera' },
]

async function collect(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true })
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith('.ts')).map((entry) => join(entry.parentPath, entry.name))
}

describe('arquitectura: regla de dependencia', () => {
  it('domain y application no importan infraestructura ni capas externas', async () => {
    const files = [...(await collect(join(SRC, 'domain'))), ...(await collect(join(SRC, 'application')))]
    expect(files.length).toBeGreaterThan(20)
    const violations: string[] = []
    for (const file of files) {
      const text = await readFile(file, 'utf8')
      for (const rule of FORBIDDEN_IN_INNER_LAYERS) {
        if (rule.pattern.test(text)) violations.push(`${file}: ${rule.reason}`)
      }
    }
    expect(violations).toEqual([])
  })

  it('la aplicación solo depende de dominio, puertos y otros casos de uso', async () => {
    const files = await collect(join(SRC, 'application'))
    const violations: string[] = []
    for (const file of files) {
      const text = await readFile(file, 'utf8')
      const imports = text.match(/from '([^']+)'/g) ?? []
      for (const entry of imports) {
        const specifier = entry.slice(6, -1)
        if (!specifier.startsWith('.')) continue
        const normalized = specifier.replace(/\.js$/, '')
        const allowed =
          normalized.startsWith('./') ||
          normalized === '../errors' ||
          normalized.startsWith('../ports/') ||
          normalized.startsWith('../../domain/')
        if (!allowed) violations.push(`${file} -> ${specifier}`)
      }
    }
    expect(violations).toEqual([])
  })
})
