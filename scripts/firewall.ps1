param(
  [switch]$Remove,
  [int]$Port = 8443
)

$ErrorActionPreference = 'Stop'
$ruleName = "Harness Movil (TCP $Port)"

if ($Remove) {
  $existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
  if ($existing) {
    Remove-NetFirewallRule -DisplayName $ruleName
    Write-Host "Regla quitada: $ruleName"
  } else {
    Write-Host "No existía la regla: $ruleName"
  }
  exit 0
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Ejecutá este script en una consola como administrador.'
}

if (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue) {
  Write-Host "La regla ya existe: $ruleName"
  exit 0
}

New-NetFirewallRule `
  -DisplayName $ruleName `
  -Description 'Harness Movil: acceso del telefono a la UI de DeepSeek Harness en la LAN' `
  -Direction Inbound `
  -Action Allow `
  -Protocol TCP `
  -LocalPort $Port `
  -Profile Private `
  -RemoteAddress LocalSubnet | Out-Null

Write-Host "Regla creada: $ruleName (TCP $Port, perfil Privada, subred local)."
Write-Host 'Si usás un perfil de red Público, cambialo a Privado o ajustá la regla a mano.'
