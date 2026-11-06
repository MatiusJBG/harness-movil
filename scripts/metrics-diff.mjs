#!/usr/bin/env node
// Métricas de cambio del plan de arquitectura limpia.
// Calcula cobertura de las líneas nuevas y duplicación (jscpd) sin añadir
// dependencias: usa git, la cobertura lcov de node --test y el jscpd instalado.
//
// Uso: node scripts/metrics-diff.mjs [base]
//      node scripts/metrics-diff.mjs --base=origin/main
//
// La cobertura NO se genera acá: `npm run metrics:new` ejecuta antes
// `npm run test:coverage`. El script falla si falta el lcov, si es anterior al
// commit HEAD o si no pertenece a este árbol (nunca reutiliza cobertura ajena).
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LCOV_PATH = join(REPO_ROOT, 'coverage', 'lcov.info')
const SRC_DIR = 'apps/bridge/src'
const REPO_DUP_TARGETS = ['apps', 'android/app/src', 'scripts']
const CODE_FILE = /\.(?:ts|js|mjs|cjs|java)$/
const DEFAULT_BASE = 'origin/main'
const JSCPD_BIN = join(REPO_ROOT, 'node_modules', 'jscpd', 'bin', 'jscpd')
const JSCPD_CONFIG = join(REPO_ROOT, '.jscpd.json')
const JSCPD_OUTPUT = join(REPO_ROOT, '.tmp', 'jscpd-metrics')
const warnings = []

function warn(message) {
  warnings.push(message)
  console.warn('[metrics-diff] aviso: ' + message)
}

function fail(message) {
  console.error('[metrics-diff] error: ' + message)
  process.exit(1)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    ...options,
  })
  return {
    ok: !result.error && result.status === 0,
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error,
  }
}

function parseArgs(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg.startsWith('--base=')) return arg.slice('--base='.length)
    if (arg === '--base' && argv[index + 1]) return argv[index + 1]
    if (!arg.startsWith('--')) return arg
  }
  return DEFAULT_BASE
}

function toRepoRelative(filePath) {
  const withSlashes = filePath.split('\\').join('/')
  if (isAbsolute(filePath)) {
    return relative(REPO_ROOT, filePath).split('\\').join('/')
  }
  return withSlashes.replace(/^\.\//, '')
}

function headCommitTimeMs() {
  const result = run('git', ['log', '-1', '--format=%ct', 'HEAD'])
  if (!result.ok) {
    const detail = result.stderr.trim() || String(result.error?.message ?? 'código ' + String(result.status))
    fail('no se pudo leer la fecha del commit HEAD: ' + detail)
  }
  const seconds = Number.parseInt(result.stdout.trim(), 10)
  if (!Number.isFinite(seconds)) fail('git devolvió una fecha de commit inválida: "' + result.stdout.trim() + '"')
  return seconds * 1000
}

/** Exige un lcov de este árbol y posterior al commit HEAD. */
function requireFreshLcov() {
  if (!existsSync(LCOV_PATH)) {
    fail('no existe coverage/lcov.info. Ejecutá `npm run test:coverage` antes de metrics:new.')
  }
  const mtimeMs = statSync(LCOV_PATH).mtimeMs
  const headTimeMs = headCommitTimeMs()
  if (mtimeMs < headTimeMs) {
    fail(
      'coverage/lcov.info (' +
        new Date(mtimeMs).toISOString() +
        ') es anterior al commit HEAD (' +
        new Date(headTimeMs).toISOString() +
        '). Regenerá la cobertura con `npm run test:coverage`.',
    )
  }
  console.log('[metrics-diff] lcov fresco: ' + toRepoRelative(LCOV_PATH))
  return mtimeMs
}

/**
 * Lee el lcov separando dos conjuntos por archivo:
 * - `instrumented`: toda línea con registro DA (haya sido ejecutada o no).
 * - `covered`: las líneas con hits > 0.
 *
 * La cobertura de código nuevo se calcula SIEMPRE sobre las líneas
 * instrumentadas del diff, no sobre todos los añadidos (que incluyen
 * comentarios, tipos e imports). Es el criterio de diff-cover.
 */
function readCoverage() {
  if (!existsSync(LCOV_PATH)) return null
  const coverage = { covered: new Map(), instrumented: new Map() }
  let current = null
  const ensure = (file) => {
    if (!coverage.covered.has(file)) coverage.covered.set(file, new Set())
    if (!coverage.instrumented.has(file)) coverage.instrumented.set(file, new Set())
  }
  for (const line of readFileSync(LCOV_PATH, 'utf8').split(/\r?\n/)) {
    if (line.startsWith('SF:')) {
      current = toRepoRelative(line.slice(3).trim())
      ensure(current)
    } else if (line.startsWith('DA:') && current !== null) {
      const [lineNumber, hits] = line.slice(3).split(',')
      const parsedLine = Number.parseInt(lineNumber, 10)
      const parsedHits = Number.parseInt(hits, 10)
      if (!Number.isInteger(parsedLine)) continue
      coverage.instrumented.get(current).add(parsedLine)
      if (Number.isInteger(parsedHits) && parsedHits > 0) coverage.covered.get(current).add(parsedLine)
    } else if (line.trim() === 'end_of_record') {
      current = null
    }
  }
  return coverage
}

/** El lcov debe referirse a rutas de este checkout, no de otro árbol. */
function assertLcovFromThisTree(coverage) {
  const keys = [...coverage.instrumented.keys()]
  if (keys.length === 0) fail('coverage/lcov.info no tiene registros SF; regenerá la cobertura.')
  const local = keys.filter((key) => key.startsWith('test-dist/') || key.startsWith(SRC_DIR + '/'))
  if (local.length === 0) {
    fail('coverage/lcov.info no contiene rutas de este árbol (' + SRC_DIR + ' o test-dist); no se reutiliza cobertura ajena.')
  }
}

function coverageFor(coverage, file) {
  if (!coverage) return null
  const direct = { covered: coverage.covered.get(file), instrumented: coverage.instrumented.get(file) }
  if (direct.instrumented) return direct
  for (const [key] of coverage.instrumented) {
    if (!key.endsWith('/' + file)) continue
    return { covered: coverage.covered.get(key), instrumented: coverage.instrumented.get(key) }
  }
  // La cobertura puede venir del JavaScript compilado en test-dist.
  const compiled = file.replace('apps/bridge/src/', 'test-dist/src/').replace(/\.ts$/, '.js')
  for (const [key] of coverage.instrumented) {
    if (key === compiled || key.endsWith('/' + compiled)) {
      return { covered: coverage.covered.get(key), instrumented: coverage.instrumented.get(key) }
    }
  }
  return null
}

function readNewLines(base) {
  const result = run('git', ['diff', '-U0', base + '...HEAD', '--', SRC_DIR])
  if (!result.ok) {
    const detail = result.stderr.trim() || String(result.error?.message ?? 'código ' + String(result.status))
    warn('no se pudo ejecutar git diff ' + base + '...HEAD: ' + detail)
    return null
  }
  const newLines = new Map()
  let currentFile = null
  for (const line of result.stdout.split(/\r?\n/)) {
    if (line.startsWith('+++ ')) {
      const target = line.slice(4).trim()
      currentFile = target === '/dev/null' ? null : target.replace(/^b\//, '')
      if (currentFile !== null && !newLines.has(currentFile)) newLines.set(currentFile, new Set())
    } else if (line.startsWith('@@ ') && currentFile !== null) {
      const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line)
      if (!match) continue
      const start = Number.parseInt(match[1], 10)
      const count = match[2] === undefined ? 1 : Number.parseInt(match[2], 10)
      for (let offset = 0; offset < count; offset += 1) newLines.get(currentFile).add(start + offset)
    }
  }
  return newLines
}

/**
 * Archivos cambiados de todo el repo: `git diff --name-only base...HEAD`,
 * filtrado por extensión de código y existencia (incluye public/js y Java).
 */
function listChangedFiles(base) {
  const result = run('git', ['diff', '--name-only', base + '...HEAD'])
  if (!result.ok) {
    const detail = result.stderr.trim() || String(result.error?.message ?? 'código ' + String(result.status))
    warn('no se pudo listar git diff --name-only ' + base + '...HEAD: ' + detail)
    return []
  }
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((file) => file !== '' && CODE_FILE.test(file) && existsSync(join(REPO_ROOT, file)))
}

function computeNewCoverage(newLines, coverage) {
  if (!newLines) return { newLines: null, newInstrumentedLines: null, newLinesCovered: null, newCoveragePct: null }
  let addedLines = 0
  let total = 0
  let covered = 0
  let filesWithCoverage = 0
  for (const [file, lines] of newLines) {
    addedLines += lines.size
    const fileCoverage = coverageFor(coverage, file)
    if (!fileCoverage || !fileCoverage.instrumented) continue
    filesWithCoverage += 1
    for (const line of lines) {
      if (!fileCoverage.instrumented.has(line)) continue
      total += 1
      if (fileCoverage.covered && fileCoverage.covered.has(line)) covered += 1
    }
  }
  if (addedLines === 0) {
    warn('git diff no reporta líneas nuevas en ' + SRC_DIR + ' respecto a la base; la cobertura de líneas nuevas no aplica.')
    return { newLines: 0, newInstrumentedLines: 0, newLinesCovered: 0, newCoveragePct: null }
  }
  if (!coverage) {
    warn('sin lcov no se puede calcular la cobertura de las ' + String(addedLines) + ' líneas nuevas.')
    return { newLines: addedLines, newInstrumentedLines: null, newLinesCovered: null, newCoveragePct: null }
  }
  if (filesWithCoverage === 0) {
    warn('el lcov no contiene rutas de ' + SRC_DIR + '; revisa la cobertura generada.')
  }
  if (total === 0) {
    warn('ninguna de las ' + String(addedLines) + ' líneas nuevas es ejecutable segun lcov; no aplica cobertura.')
    return { newLines: addedLines, newInstrumentedLines: 0, newLinesCovered: 0, newCoveragePct: null }
  }
  return {
    newLines: addedLines,
    newInstrumentedLines: total,
    newLinesCovered: covered,
    newCoveragePct: (covered / total) * 100,
  }
}

function runJscpd(label, targets, outputDir) {
  if (!existsSync(JSCPD_BIN)) {
    warn('jscpd no está instalado en node_modules; se omite la duplicación de ' + label + '.')
    return null
  }
  if (targets.length === 0) return null
  rmSync(outputDir, { recursive: true, force: true })
  mkdirSync(outputDir, { recursive: true })
  const args = [
    JSCPD_BIN,
    ...targets,
    '--threshold', '0',
    '--min-lines', '5',
    '--min-tokens', '50',
    '--reporters', 'json',
    '--output', outputDir,
    '--silent',
  ]
  if (existsSync(JSCPD_CONFIG)) args.push('--config', JSCPD_CONFIG)
  const result = run(process.execPath, args)
  const reportPath = join(outputDir, 'jscpd-report.json')
  if (!existsSync(reportPath)) {
    const detail = result.stderr.trim() || 'sin reporte JSON'
    warn('jscpd falló para ' + label + ': ' + detail)
    return null
  }
  try {
    const report = JSON.parse(readFileSync(reportPath, 'utf8'))
    const percentage = report?.statistics?.total?.percentage
    if (typeof percentage !== 'number') {
      warn('el reporte de jscpd para ' + label + ' no incluye el porcentaje total.')
      return null
    }
    return percentage
  } catch (error) {
    warn('no se pudo leer el reporte de jscpd para ' + label + ': ' + String(error))
    return null
  }
}

function printSummary(summary) {
  const value = (input, suffix) => (typeof input === 'number' ? String(Math.round(input * 100) / 100) + suffix : 'n/a')
  console.log('')
  console.log('Resumen de métricas de cambio')
  console.log('  base:            ' + summary.base)
  console.log('  newLines:        ' + (summary.newLines === null ? 'n/a' : String(summary.newLines)))
  console.log('  newExecutable:   ' + (summary.newInstrumentedLines === null ? 'n/a' : String(summary.newInstrumentedLines)))
  console.log('  newLinesCovered: ' + (summary.newLinesCovered === null ? 'n/a' : String(summary.newLinesCovered)))
  console.log('  newCoveragePct:  ' + value(summary.newCoveragePct, '%'))
  console.log('  repoDupPct:      ' + value(summary.repoDupPct, '%'))
  console.log('  newDupPct:       ' + value(summary.newDupPct, '%'))
  if (warnings.length > 0) console.log('  avisos:          ' + String(warnings.length))
}

function main() {
  const base = parseArgs(process.argv.slice(2))
  console.log('[metrics-diff] Base de comparación: ' + base)
  requireFreshLcov()
  const coverage = readCoverage()
  if (!coverage) fail('no se pudo leer coverage/lcov.info.')
  assertLcovFromThisTree(coverage)
  const newLines = readNewLines(base)
  const coverageSummary = computeNewCoverage(newLines, coverage)
  const changedFiles = listChangedFiles(base)
  const repoDupPct = runJscpd('repo (' + REPO_DUP_TARGETS.join('+') + ')', REPO_DUP_TARGETS, join(JSCPD_OUTPUT, 'repo'))
  const newDupPct = runJscpd('archivos cambiados', changedFiles, join(JSCPD_OUTPUT, 'changed'))
  if (changedFiles.length === 0) {
    console.log('[metrics-diff] Sin archivos de código cambiados: newDupPct no aplica.')
  }
  printSummary({
    base,
    newLines: coverageSummary.newLines,
    newInstrumentedLines: coverageSummary.newInstrumentedLines,
    newLinesCovered: coverageSummary.newLinesCovered,
    newCoveragePct: coverageSummary.newCoveragePct,
    repoDupPct,
    newDupPct,
  })
}

main()
