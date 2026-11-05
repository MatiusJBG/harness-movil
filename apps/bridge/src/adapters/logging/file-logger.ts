import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs'
import { dirname } from 'node:path'
import type { Clock } from '../../application/ports/clock.js'
import type { LogFields, Logger, LogLevel } from '../../application/ports/logger.js'
import { redactFields, scrubString } from '../shared/redaction.js'

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

export interface FileLoggerOptions {
  readonly level?: LogLevel
  readonly file?: string
  readonly console?: boolean
  readonly clock: Clock
}

/** Log JSON con secretos redactados; escribe a archivo y consola. */
export function createFileLogger(options: FileLoggerOptions): Logger {
  const minLevel = LEVEL_ORDER[options.level ?? 'info']
  const toConsole = options.console ?? true
  let stream: WriteStream | null = null
  if (options.file !== undefined) {
    mkdirSync(dirname(options.file), { recursive: true })
    stream = createWriteStream(options.file, { flags: 'a' })
    stream.on('error', () => {
      stream = null
    })
  }

  const write = (level: LogLevel, message: string, bindings: LogFields, fields?: LogFields): void => {
    if (LEVEL_ORDER[level] < minLevel) return
    const record: Record<string, unknown> = {
      time: options.clock.now().toISOString(),
      level,
      msg: scrubString(message),
      ...redactFields({ ...bindings, ...fields }),
    }
    const line = JSON.stringify(record)
    if (stream !== null) stream.write(`${line}\n`)
    if (!toConsole) return
    const target = level === 'error' || level === 'warn' ? console.error : console.log
    target(`[${String(record.time)}] ${level.toUpperCase()} ${String(record.msg)}${formatExtra(record)}`)
  }

  const make = (bindings: LogFields): Logger => ({
    debug: (message, fields): void => {
      write('debug', message, bindings, fields)
    },
    info: (message, fields): void => {
      write('info', message, bindings, fields)
    },
    warn: (message, fields): void => {
      write('warn', message, bindings, fields)
    },
    error: (message, fields): void => {
      write('error', message, bindings, fields)
    },
    child: (extra): Logger => make({ ...bindings, ...extra }),
    close: async (): Promise<void> => {
      const closing = stream
      if (closing === null) return
      stream = null
      await new Promise<void>((resolve) => {
        closing.end(resolve)
      })
    },
  })

  return make({})
}

function formatExtra(record: Record<string, unknown>): string {
  const keys = Object.keys(record).filter((key) => key !== 'time' && key !== 'level' && key !== 'msg')
  if (keys.length === 0) return ''
  return ` ${keys.map((key) => `${key}=${String(record[key])}`).join(' ')}`
}
