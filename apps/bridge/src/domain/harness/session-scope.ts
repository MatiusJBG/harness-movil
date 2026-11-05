export type SessionScope = 'isolated' | 'shared'

/**
 * El host móvil no puede compartir el log JSONL con la app de escritorio
 * (lock de escritor único por sesión); `isolated` le da su propio directorio.
 */
export function sessionsRootName(scope: SessionScope): string {
  return scope === 'shared' ? 'sessions' : 'sessions-mobile'
}

export function usesIsolatedSessions(scope: SessionScope): boolean {
  return scope !== 'shared'
}
