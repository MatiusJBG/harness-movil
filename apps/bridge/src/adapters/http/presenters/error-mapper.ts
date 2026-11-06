import {
  ApplicationError,
  DeviceLimitReachedError,
  DeviceNotFoundError,
  HarnessStartError,
  HarnessUnavailableError,
  NotAuthorizedError,
  TicketInvalidError,
} from '../../../application/errors.js'
import { DomainError } from '../../../domain/shared/domain-error.js'
import { BodyTooLargeError, InvalidBodyError } from '../middleware/request-meta.js'

export interface MappedError {
  readonly status: number
  readonly code: string
  readonly message: string
  readonly expected: boolean
}

/**
 * Traducción única de errores a HTTP. Un error nuevo solo añade una rama aquí:
 * los controladores no conocen códigos de estado.
 */
export function mapError(error: unknown): MappedError {
  if (error instanceof TicketInvalidError) {
    return { status: 401, code: error.code, message: error.message, expected: true }
  }
  if (error instanceof DeviceLimitReachedError) {
    return { status: 409, code: error.code, message: error.message, expected: true }
  }
  if (error instanceof DeviceNotFoundError) {
    return { status: 404, code: error.code, message: error.message, expected: true }
  }
  if (error instanceof NotAuthorizedError) {
    return { status: 403, code: error.code, message: error.message, expected: true }
  }
  if (error instanceof HarnessUnavailableError || error instanceof HarnessStartError) {
    return { status: 503, code: error.code, message: error.message, expected: true }
  }
  if (error instanceof BodyTooLargeError) {
    return { status: 413, code: 'body-too-large', message: error.message, expected: true }
  }
  if (error instanceof InvalidBodyError) {
    return { status: 400, code: 'invalid-body', message: error.message, expected: true }
  }
  if (error instanceof DomainError) {
    return { status: 400, code: error.code, message: error.message, expected: true }
  }
  if (error instanceof ApplicationError) {
    return { status: 400, code: error.code, message: error.message, expected: true }
  }
  return {
    status: 500,
    code: 'internal-error',
    message: error instanceof Error ? error.message : String(error),
    expected: false,
  }
}
