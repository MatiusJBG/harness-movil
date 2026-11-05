export interface ParsedDeviceToken {
  id: string
  secret: string
}

/**
 * Formato del token de dispositivo: `<id>.<secreto>`. El identificador es
 * público (viaja en el panel); el secreto solo se guarda hasheado.
 */
export function parseDeviceToken(token: string | null | undefined): ParsedDeviceToken | null {
  if (typeof token !== 'string' || token === '') return null
  const separator = token.indexOf('.')
  if (separator <= 0) return null
  const id = token.slice(0, separator)
  const secret = token.slice(separator + 1)
  if (id === '' || secret === '') return null
  return { id, secret }
}

export function formatDeviceToken(id: string, secret: string): string {
  return `${id}.${secret}`
}
