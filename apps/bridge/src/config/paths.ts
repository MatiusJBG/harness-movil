import { homedir } from 'node:os'
import { join } from 'node:path'
import type { DataPaths } from '../application/ports/settings.js'

export function defaultDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.HARNESS_MOVIL_DATA_DIR
  if (configured !== undefined && configured.trim() !== '') return configured
  const local = env.LOCALAPPDATA
  if (local !== undefined && local.trim() !== '') return join(local, 'harness-movil')
  return join(homedir(), '.local', 'share', 'harness-movil')
}

export function dataPaths(dataDir: string, dshHome: string): DataPaths {
  return {
    dataDir,
    configFile: join(dataDir, 'config.json'),
    tlsDir: join(dataDir, 'tls'),
    devicesFile: join(dataDir, 'devices.json'),
    logDir: join(dataDir, 'logs'),
    dshHome,
  }
}
