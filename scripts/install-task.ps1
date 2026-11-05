param(
  [string]$TaskName = 'Harness Movil'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$entry = Join-Path $root 'apps\bridge\dist\main.js'
$launcher = Join-Path $root 'scripts\start-hidden.vbs'

if (-not (Test-Path $entry)) {
  Write-Host 'Compilando el puente...'
  Push-Location $root
  try {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'npm run build falló.' }
  } finally {
    Pop-Location
  }
}

if (-not (Test-Path $launcher)) {
  throw "No se encontró el lanzador: $launcher"
}

$action = "wscript.exe `"$launcher`""
Write-Host "Registrando tarea '$TaskName' al iniciar sesión..."
schtasks.exe /Create /TN $TaskName /TR $action /SC ONLOGON /RL LIMITED /F | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "schtasks falló (código $LASTEXITCODE). Probá desde una consola como administrador."
}

Write-Host "Listo. La tarea '$TaskName' arranca el puente al iniciar sesión."
Write-Host 'El panel queda en http://127.0.0.1:8444/_hm/ y la conexión con Harness se activa desde el teléfono.'
