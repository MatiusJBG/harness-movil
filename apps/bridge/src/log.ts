import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs'
import { join } from 'node:path'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogFields = Record<string, unknown>

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }
const SECRET_KEY = /token|secret|cookie|password|authorization|passwd/i
const SECRET_PATTERN = /\b(token|secret|cookie|authorization|password)=([^\s&"']+)/gi
const DSH_COOKIE_PATTERN = /dsh-auth-[A-Za-z0-9_-]+=[^\s;,"']+/g

export function scrubString(value: string): string {
  return value
    .replace(SECRET_PATTERN, (_match, key: string) => `${key}=<redacted>`)
    .replace(DSH_COOKIE_PATTERN, 'dsh-auth-<redacted>')
}

export function redactFields(fields: LogFields | undefined, depth = 0): LogFields | undefined {
  if (!fields) return undefined
  if (depth > 4) return { truncated: true }
  const out: LogFields = {}
  for (const [key, value] of Object.entries(fields)) {
    if (SECRET_KEY.test(key)) {
      out[key] = '<redacted>'
      continue
    }
    if (typeof value === 'string') {
      out[key] = scrubString(value)
    } else if (Array.isArray(value)) {
      out[key] = value.map((item) =>
        typeof item === 'string' ? scrubString(item) : item && typeof item === 'object' ? redactFields(item as LogFields, depth + 1) : item,
      )
    } else if (value && typeof value === 'object') {
      out[key] = redactFields(value as LogFields, depth + 1)
    } else {
      out[key] = value
    }
  }
  return out
}

export interface Logger {
  debug(message: string, fields?: LogFields): void
  info(message: string, fields?: LogFields): void
  warn(message: string, fields?: LogFields): void
  error(message: string, fields?: LogFields): void
  child(bindings: LogFields): Logger
  close(): Promise<void>
}

export interface LoggerOptions {
  level?: LogLevel
  file?: string
  console?: boolean
  now?: () => Date
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const minLevel = LEVEL_ORDER[options.level ?? 'info']
  const toConsole = options.console ?? true
  const now = options.now ?? (() => new Date())
  let stream: WriteStream | null = null
  if (options.file) {
    mkdirSync(join(options.file, '..'), { recursive: true })
    stream = createWriteStream(options.file, { flags: 'a' })
    stream.on('error', () => {
      stream = null
    })
  }

  const write = (level: LogLevel, message: string, bindings: LogFields, fields?: LogFields) => {
    if (LEVEL_ORDER[level] < minLevel) return
    const record = {
      time: now().toISOString(),
      level,
      msg: scrubString(message),
      ...redactFields({ ...bindings, ...fields }),
    }
    const line = JSON.stringify(record)
    if (stream) stream.write(`${line}\n`)
    if (toConsole) {
      const target = level === 'error' || level === 'warn' ? console.error : console.log
      target(`[${record.time}] ${level.toUpperCase()} ${record.msg}${formatExtra(record)}`)
    }
  }

  const make = (bindings: LogFields): Logger => ({
    debug: (message, fields) => write('debug', message, bindings, fields),
    info: (message, fields) => write('info', message, bindings, fields),
    warn: (message, fields) => write('warn', message, bindings, fields),
    error: (message, fields) => write('error', message, bindings, fields),
    child: (extra) => make({ ...bindings, ...extra }),
    close: async () => {
      if (!stream) return
      const closing = stream
      stream = null
      await new Promise<void>((resolve) => closing.end(resolve))
    },
  })

  return make({})
}

function formatExtra(record: Record<string, unknown>): string {
  const { time: _time, level: _level, msg: _msg, ...rest } = record
  const keys = Object.keys(rest)
  if (keys.length === 0) return ''
  return ` ${keys.map((key) => `${key}=${String(rest[key])}`).join(' ')}`
}
