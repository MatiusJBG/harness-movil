export interface BuildDshArgsOptions {
  readonly profile: string
  readonly port: number
  readonly publicUrl: string
  readonly extraArgs: readonly string[]
  readonly profileExists: boolean
  readonly patches?: readonly string[]
}

export function buildDshArgs(options: BuildDshArgsOptions): string[] {
  const args: string[] = [options.profile]
  if (!options.profileExists) args.push('--from-default-profile', 'web')
  for (const patch of options.patches ?? []) args.push('--patch', patch)
  args.push('--no-open', '--host', '127.0.0.1', '--port', String(options.port), '--public-url', options.publicUrl)
  args.push(...options.extraArgs)
  return args
}

export interface SpawnCommand {
  readonly file: string
  readonly args: string[]
  readonly windowsVerbatimArguments?: boolean
}

function quoteWindowsArg(value: string): string {
  if (value === '') return '""'
  if (!/[\s"&|<>^]/.test(value)) return value
  return `"${value.replace(/"/g, '""')}"`
}

/** Los `.cmd`/`.bat` de Windows necesitan cmd.exe; el resto se lanza directo. */
export function toSpawnCommand(command: string, args: readonly string[]): SpawnCommand {
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(command)) {
    const line = [quoteWindowsArg(command), ...args.map(quoteWindowsArg)].join(' ')
    return {
      file: process.env.ComSpec ?? 'cmd.exe',
      args: ['/d', '/s', '/c', `"${line}"`],
      windowsVerbatimArguments: true,
    }
  }
  return { file: command, args: [...args] }
}
