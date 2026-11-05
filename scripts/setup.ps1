$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  throw 'No se encontró Node.js. Instalá Node 22 o superior y volvé a ejecutar.'
}
$major = [int]((& node --version).TrimStart('v').Split('.')[0])
if ($major -lt 22) {
  throw "Node.js $major es demasiado viejo; se necesita 22 o superior."
}

Write-Host "Instalando dependencias con Node $(& node --version)..."
npm install --ignore-scripts --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'npm install falló.' }

Write-Host 'Compilando...'
npm run build
if ($LASTEXITCODE -ne 0) { throw 'npm run build falló.' }

Write-Host ''
Write-Host 'Listo. Próximos pasos:'
Write-Host '  1) npm start'
Write-Host '  2) En la PC: http://127.0.0.1:8444/_hm/'
Write-Host '  3) En el teléfono: https://<ip-lan>:8443/_hm/ (instalá antes la CA desde /_hm/ca.cer)'
Write-Host '  4) Firewall (admin): powershell -ExecutionPolicy Bypass -File scripts\firewall.ps1'
Write-Host '  5) Autostart (admin): powershell -ExecutionPolicy Bypass -File scripts\install-task.ps1'
