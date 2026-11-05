import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { HarnessStartError } from '../../application/errors.js'

export interface DshCommandSettings {
  readonly command: string
}

export function findOnPath(name: string, env: NodeJS.ProcessEnv): string | null {
  const pathValue = env.PATH ?? env.Path ?? ''
  const extensions = process.platform === 'win32' ? ['.cmd', '.exe', '.bat', ''] : ['']
  for (const directory of pathValue.split(delimiter)) {
    if (directory.trim() === '') continue
    for (const extension of extensions) {
      const candidate = join(directory, `${name}${extension}`)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

/** `auto` prueba PATH y luego el CLI que trae la app de escritorio. */
export function resolveDshCommand(settings: DshCommandSettings, env: NodeJS.ProcessEnv = process.env): string {
  const configured = settings.command
  if (configured !== 'auto') {
    if (existsSync(configured)) return configured
    const onPath = findOnPath(configured, env)
    if (onPath !== null) return onPath
    throw new HarnessStartError(
      `No se encontró el comando dsh configurado ("${configured}"). Corregí harness.command en config.json.`,
    )
  }

  const onPath = findOnPath('dsh', env)
  if (onPath !== null) return onPath

  const localAppData = env.LOCALAPPDATA ?? ''
  const bundled = [
    join(localAppData, 'Programs', 'DeepSeek Harness', 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd'),
    join(env.ProgramFiles ?? 'C:\\Program Files', 'DeepSeek Harness', 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd'),
  ].find((candidate) => candidate !== '' && existsSync(candidate))
  if (bundled !== undefined) return bundled

  throw new HarnessStartError(
    'No se encontró dsh. Instalá el CLI de DeepSeek Harness, agregalo al PATH o fijá harness.command en config.json.',
  )
}
