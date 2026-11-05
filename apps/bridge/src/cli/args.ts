export interface CliArgs {
  readonly dataDir?: string
  readonly help: boolean
  readonly checkConfig: boolean
}

export function parseArgs(argv: readonly string[]): CliArgs {
  let dataDir: string | undefined
  let help = false
  let checkConfig = false
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--data-dir') {
      const value = argv[index + 1]
      if (value === undefined) throw new Error('--data-dir requiere una ruta')
      dataDir = value
      index += 1
    } else if (arg === '--help' || arg === '-h') {
      help = true
    } else if (arg === '--check-config') {
      checkConfig = true
    } else {
      throw new Error(`Argumento desconocido: ${String(arg)}`)
    }
  }
  return { dataDir, help, checkConfig }
}
