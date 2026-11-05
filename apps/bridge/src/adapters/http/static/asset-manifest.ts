import { readdir, readFile } from 'node:fs/promises'
import { join, posix, relative } from 'node:path'

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.woff2': 'font/woff2',
}

const NO_STORE = new Set(['.html', '.js', '.mjs', '.webmanifest'])

export interface StaticAsset {
  readonly body: Buffer
  readonly type: string
  readonly cacheControl: string
}

export interface AssetSource {
  get(path: string): StaticAsset | null
}

/**
 * Manifiesto del panel: escanea `public/` al arrancar, resuelve el MIME por
 * extensión y bloquea traversal. Añadir un asset no requiere tocar el router.
 */
export class PublicAssetManifest implements AssetSource {
  private constructor(private readonly assets: ReadonlyMap<string, StaticAsset>) {}

  static async load(publicDir: string): Promise<PublicAssetManifest> {
    const entries = await readdir(publicDir, { recursive: true, withFileTypes: true })
    const assets = new Map<string, StaticAsset>()
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const absolute = join(entry.parentPath, entry.name)
      const assetPath = relative(publicDir, absolute).replaceAll('\\', '/')
      const extension = posix.extname(assetPath).toLowerCase()
      assets.set(assetPath, {
        body: await readFile(absolute),
        type: CONTENT_TYPES[extension] ?? 'application/octet-stream',
        cacheControl: NO_STORE.has(extension) ? 'no-store' : 'public, max-age=300',
      })
    }
    if (!assets.has('index.html')) {
      throw new Error(`Falta el panel del puente: ${join(publicDir, 'index.html')}`)
    }
    return new PublicAssetManifest(assets)
  }

  get(path: string): StaticAsset | null {
    const relative = path === '/_hm' || path === '/_hm/' ? 'index.html' : path.slice('/_hm/'.length)
    if (relative === '' || relative.includes('..') || relative.startsWith('/')) return null
    return this.assets.get(posix.normalize(relative)) ?? null
  }
}
