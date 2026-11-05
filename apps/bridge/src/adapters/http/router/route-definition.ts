import type { IncomingMessage, ServerResponse } from 'node:http'
import type { PublicDevice } from '../../../domain/device/device.js'

export type HttpMethod = 'GET' | 'HEAD' | 'POST' | 'DELETE'
export type RouteAccess = 'public' | 'paired' | 'admin'

export interface RequestContext {
  readonly req: IncomingMessage
  readonly res: ServerResponse
  readonly path: string
  readonly search: URLSearchParams
  readonly admin: boolean
  readonly device: PublicDevice | null
  readonly ip: string
  readonly params: Readonly<Record<string, string>>
}

export interface RouteDefinition {
  readonly method: HttpMethod
  /** Literal, con `:param` por segmento y `*` final para prefijos. */
  readonly pattern: string
  /** Obligatorio a propósito: una ruta nueva sin declaración no compila. */
  readonly access: RouteAccess
  /** Exige same-origin + cabecera anti-CSRF. */
  readonly mutation: boolean
  readonly rateLimit?: 'pairing'
  readonly handle: (ctx: RequestContext) => Promise<void> | void
}

export interface RouteMatch {
  readonly route: RouteDefinition
  readonly params: Readonly<Record<string, string>>
}

/**
 * Coincidencia de patrones: segmentos literales, `:param` y `/*` final.
 * Devuelve null cuando no coincide; nunca lanza.
 */
export function matchPattern(pattern: string, path: string): Record<string, string> | null {
  if (pattern.endsWith('/*')) {
    const prefix = pattern.slice(0, -1)
    if (!path.startsWith(prefix)) return null
    return { rest: path.slice(prefix.length) }
  }
  const patternParts = pattern.split('/')
  const pathParts = path.split('/')
  if (patternParts.length !== pathParts.length) return null
  const params: Record<string, string> = {}
  for (let index = 0; index < patternParts.length; index += 1) {
    const expected = patternParts[index]
    const actual = pathParts[index]
    if (expected === undefined || actual === undefined) return null
    if (expected.startsWith(':')) {
      if (actual === '') return null
      try {
        params[expected.slice(1)] = decodeURIComponent(actual)
      } catch {
        return null
      }
      continue
    }
    if (expected !== actual) return null
  }
  return params
}

/** HEAD se atiende con la ruta GET: mismos encabezados, sin cuerpo. */
export function findRoute(
  routes: readonly RouteDefinition[],
  method: string,
  path: string,
): RouteMatch | null {
  const normalized = method === 'HEAD' ? 'HEAD' : method
  for (const route of routes) {
    const methodMatches = route.method === normalized || (normalized === 'HEAD' && route.method === 'GET')
    if (!methodMatches) continue
    const params = matchPattern(route.pattern, path)
    if (params !== null) return { route, params }
  }
  return null
}
