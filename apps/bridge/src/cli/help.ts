export function printHelp(): void {
  console.log(`Harness Móvil — puente PC-telefono para DeepSeek Harness

Uso:
  npm start [-- --data-dir <ruta>] [--check-config]

Opciones:
  --data-dir <ruta>   carpeta de datos (default: %LOCALAPPDATA%\\harness-movil)
  --check-config      valida y migra la configuración sin arrancar los servidores
  -h, --help          muestra esta ayuda

Variables:
  HARNESS_MOVIL_DATA_DIR    carpeta de datos
  HARNESS_MOVIL_LOG_LEVEL   debug | info | warn | error (default: info)
  HARNESS_MOVIL_PREFERRED_IP  IPv4 preferida cuando server.lan.host = "auto"

La configuración vive en <data-dir>/config.json (schemaVersion 2).
Un config v1 se migra automáticamente y se respalda como config.v1.json.`)
}
