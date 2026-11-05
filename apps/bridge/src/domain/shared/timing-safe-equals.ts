/**
 * Comparación de longitud constante sin dependencias de Node, para que el
 * dominio pueda validar secretos sin importar `node:crypto`.
 *
 * La longitud no se oculta (es inherente a la comparación), pero el contenido
 * se recorre completo aunque el primer byte difiera.
 */
export function timingSafeEquals(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return difference === 0
}
