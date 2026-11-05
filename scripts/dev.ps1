$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not (Test-Path 'node_modules')) {
  npm install --ignore-scripts --no-audit --no-fund
}
npm run build
if ($LASTEXITCODE -ne 0) { throw 'npm run build falló.' }

$env:HARNESS_MOVIL_LOG_LEVEL = if ($env:HARNESS_MOVIL_LOG_LEVEL) { $env:HARNESS_MOVIL_LOG_LEVEL } else { 'debug' }
Write-Host 'Arrancando el puente en modo desarrollo (Ctrl+C para salir)...'
npm start
