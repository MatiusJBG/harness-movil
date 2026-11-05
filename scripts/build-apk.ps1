param(
  [switch]$Clean,
  [string]$CaFile
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$android = Join-Path $root 'android'

if (-not (Test-Path $android)) {
  throw "No se encontró la carpeta android/: $android"
}

$jdkCandidates = @(
  @(
    'C:\Program Files\Java\jdk-21.0.10',
    'C:\Program Files\Java\jdk-21',
    $env:JAVA_HOME
  ) | Where-Object { $_ -and (Test-Path (Join-Path $_ 'bin\java.exe')) }
)

if (-not $jdkCandidates) {
  throw 'No se encontró un JDK 21. Instalá Temurin 21 o ajustá JAVA_HOME.'
}
$env:JAVA_HOME = $jdkCandidates[0]

$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } elseif ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
if (-not (Test-Path (Join-Path $sdk 'platforms'))) {
  throw "No se encontró el Android SDK en $sdk. Instalá Android Studio o ajustá ANDROID_HOME."
}
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk

if (-not (Test-Path (Join-Path $android 'gradlew.bat'))) {
  throw 'Falta el wrapper de Gradle en android/gradlew.bat.'
}

if (-not $CaFile) {
  $dataDir = if ($env:HARNESS_MOVIL_DATA_DIR) { $env:HARNESS_MOVIL_DATA_DIR } else { Join-Path $env:LOCALAPPDATA 'harness-movil' }
  $CaFile = Join-Path $dataDir 'tls\ca.pem'
}
if (-not (Test-Path $CaFile)) {
  throw "No se encontró la CA del puente en $CaFile. Iniciá el puente una vez o pasá -CaFile <ruta a ca.pem>."
}
$rawDir = Join-Path $android 'app\src\main\res\raw'
New-Item -ItemType Directory -Force $rawDir | Out-Null
Copy-Item $CaFile (Join-Path $rawDir 'harness_ca.pem') -Force
Write-Host "CA incluida en el APK: $CaFile"

Push-Location $android
try {
  if ($Clean) {
    & .\gradlew.bat clean --no-daemon
    if ($LASTEXITCODE -ne 0) { throw 'gradlew clean falló.' }
  }
  Write-Host "Compilando APK con JDK $env:JAVA_HOME..."
  & .\gradlew.bat assembleDebug --no-daemon
  if ($LASTEXITCODE -ne 0) { throw 'gradlew assembleDebug falló.' }
} finally {
  Pop-Location
}

$apk = Join-Path $android 'app\build\outputs\apk\debug\app-debug.apk'
if (-not (Test-Path $apk)) {
  throw "No se generó el APK esperado: $apk"
}

$versionLine = Select-String -Path (Join-Path $android 'app\build.gradle') -Pattern "versionName\s+'([^']+)'" | Select-Object -First 1
$version = if ($versionLine) { $versionLine.Matches[0].Groups[1].Value } else { '0.0.0' }

$artifacts = Join-Path $android 'artifacts'
New-Item -ItemType Directory -Force $artifacts | Out-Null
$target = Join-Path $artifacts "HarnessMovil-$version-debug.apk"
Copy-Item $apk $target -Force

Write-Host ''
Write-Host "APK: $target"
Write-Host "Instalar por USB: adb install -r `"$target`""
