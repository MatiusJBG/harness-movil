/**
 * Error de regla de negocio. El dominio nunca conoce códigos HTTP: la capa de
 * aplicación lo traduce a un error propio y el adaptador HTTP a un status.
 */
export class DomainError extends Error {
  override name = 'DomainError'

  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message)
  }
}
