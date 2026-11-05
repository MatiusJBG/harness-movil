import { readFileSync } from 'node:fs'

/**
 * Lee la versión del manifiesto. Recibe la URL ya resuelta por composición para
 * que este adaptador no dependa de la profundidad del directorio de salida.
 */
export function readVersionFrom(manifestUrl: URL): string {
  try {
    const parsed: unknown = JSON.parse(readFileSync(manifestUrl, 'utf8'))
    if (parsed !== null && typeof parsed === 'object' && 'version' in parsed) {
      const version = (parsed as { version?: unknown }).version
      return typeof version === 'string' ? version : '0.0.0'
    }
    return '0.0.0'
  } catch {
    return '0.0.0'
  }
}
