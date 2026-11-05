const MAX_DEVICE_NAME_LENGTH = 60
// eslint-disable-next-line no-control-regex -- el saneado debe eliminar caracteres de control
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g

export const DEFAULT_DEVICE_NAME = 'Dispositivo'

/**
 * Nombre visible de un dispositivo: sin caracteres de control, sin extremos en
 * blanco y con un reemplazo cuando el usuario no escribió nada.
 */
export function sanitizeDeviceName(input: unknown): string {
  const text = typeof input === 'string' ? input.trim() : ''
  const cleaned = text.replace(CONTROL_CHARACTERS, '').slice(0, MAX_DEVICE_NAME_LENGTH)
  return cleaned === '' ? DEFAULT_DEVICE_NAME : cleaned
}
