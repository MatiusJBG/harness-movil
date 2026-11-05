/** Error de configuración con código estable para diagnóstico. */
export class ConfigError extends Error {
  override name = 'ConfigError'

  constructor(
    message: string,
    readonly code = 'config-invalid',
  ) {
    super(message)
  }
}
