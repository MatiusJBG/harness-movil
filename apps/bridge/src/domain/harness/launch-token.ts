/**
 * El stdout de `dsh web` imprime una URL con el token de proceso. La URL puede
 * anunciar el host público, así que el token se extrae con una regex que ignora
 * el host a propósito.
 */
export const LAUNCH_TOKEN_PATTERN = /[?&]token=([A-Za-z0-9._~-]+)/

export function extractLaunchToken(text: string): string | null {
  const match = LAUNCH_TOKEN_PATTERN.exec(text)
  return match?.[1] ?? null
}
