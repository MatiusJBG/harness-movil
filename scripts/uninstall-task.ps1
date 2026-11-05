param(
  [string]$TaskName = 'Harness Movil'
)

$ErrorActionPreference = 'Continue'
$existing = schtasks.exe /Query /TN $TaskName 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host "No existe la tarea '$TaskName'."
  exit 0
}

schtasks.exe /Delete /TN $TaskName /F | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host "No se pudo eliminar la tarea '$TaskName'."
  exit 1
}

Write-Host "Tarea '$TaskName' eliminada."
