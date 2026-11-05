import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { usesIsolatedSessions, type SessionScope } from '../../domain/harness/session-scope.js'

export const OVERLAY_PATCH_FILE = 'mobile-overlay.patch.yml'

/**
 * El host móvil no debe compartir el log JSONL con la app de escritorio: ambos
 * tomarían el lock de escritor único de la misma sesión.
 */
export function buildSessionsPatch(): string {
  return [
    '# Aisla el log de sesiones del host movil del que usa la app de escritorio.',
    '- id: session-persistence-jsonl',
    '  config:',
    "    root: !!js dshHomePath('sessions-mobile')",
  ].join('\n')
}

/** Copia la fila `agent-default-model` del perfil desktop, verbatim. */
export function extractAgentDefaultModel(patchText: string): string | null {
  const lines = patchText.split(/\r?\n/)
  const start = lines.findIndex((line) => /^- id:\s*agent-default-model\s*$/.test(line))
  if (start === -1) return null
  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (line === undefined) continue
    if (/^-\s/.test(line)) {
      end = index
      break
    }
  }
  const block = lines.slice(start, end).join('\n').trimEnd()
  return block === '' ? null : block
}

export interface OverlayPatchOptions {
  readonly dataDir: string
  readonly dshHome: string
  readonly sessions: SessionScope
}

export async function ensureOverlayPatch(options: OverlayPatchOptions): Promise<string | null> {
  const parts: string[] = []
  if (usesIsolatedSessions(options.sessions)) parts.push(buildSessionsPatch())
  const model = await readDesktopModelBlock(options.dshHome)
  if (model !== null) parts.push(model)
  if (parts.length === 0) return null

  const file = join(options.dataDir, OVERLAY_PATCH_FILE)
  await mkdir(options.dataDir, { recursive: true })
  const content = ['# Generado por Harness Movil. No editar a mano.', '', ...parts, ''].join('\n')
  await writeFile(file, content, 'utf8')
  return file
}

async function readDesktopModelBlock(dshHome: string): Promise<string | null> {
  const file = join(dshHome, 'profiles', 'desktop', 'cordis.patch.yml')
  if (!existsSync(file)) return null
  try {
    return extractAgentDefaultModel(await readFile(file, 'utf8'))
  } catch {
    return null
  }
}
