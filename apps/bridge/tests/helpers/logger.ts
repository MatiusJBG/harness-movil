import { createLogger, redactFields, scrubString, type Logger } from '../../src/log.js'

export const silentLogger: Logger = createLogger({ console: false, level: 'error' })

export { scrubString, redactFields }
