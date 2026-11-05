import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'

export async function makeTempDir(prefix = 'hm-test-'): Promise<string> {
  const base = join(process.cwd(), '.tmp')
  await mkdir(base, { recursive: true })
  return mkdtemp(join(base, prefix))
}

export async function removeTempDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }).catch(() => undefined)
}
