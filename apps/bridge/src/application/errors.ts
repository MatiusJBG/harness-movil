/**
 * Errores de aplicación: describen el fallo de un caso de uso sin acoplarse a
 * HTTP. El adaptador HTTP los traduce a status + código estable.
 */
export class ApplicationError extends Error {
  override name = 'ApplicationError'

  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message)
  }
}

export class TicketInvalidError extends ApplicationError {
  constructor(message = 'El código no es válido o ya venció. Pedí uno nuevo en la PC.') {
    super(message, 'ticket-invalid')
  }
}

export class DeviceLimitReachedError extends ApplicationError {
  constructor(maxDevices: number) {
    super(
      `Ya hay ${String(maxDevices)} dispositivos activos. Revocá uno desde el panel antes de emparejar otro.`,
      'device-limit-reached',
    )
  }
}

export class DeviceNotFoundError extends ApplicationError {
  constructor() {
    super('Dispositivo inexistente o ya revocado.', 'device-not-found')
  }
}

export class NotAuthorizedError extends ApplicationError {
  constructor(message = 'No podés realizar esta acción sobre otro dispositivo.') {
    super(message, 'not-authorized')
  }
}

export class HarnessUnavailableError extends ApplicationError {
  constructor(message = 'El host Harness todavía no está listo.') {
    super(message, 'harness-unavailable')
  }
}

/** Fallo al localizar o arrancar el CLI de Harness (últimas líneas en `detail`). */
export class HarnessStartError extends ApplicationError {
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message, 'harness-start-failed')
  }
}
