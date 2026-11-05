export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogFields = Readonly<Record<string, unknown>>

export interface Logger {
  debug(message: string, fields?: LogFields): void
  info(message: string, fields?: LogFields): void
  warn(message: string, fields?: LogFields): void
  error(message: string, fields?: LogFields): void
  child(bindings: LogFields): Logger
  close(): Promise<void>
}
