# ADR 0003 — Android como adaptador delgado del puente

- Estado: aceptado
- Fecha: 2026-11-05
- Contexto: app Android WebView (Java) del envoltorio `Harness Móvil`; el puente Node se dividió en
  dominio, aplicación y adaptadores, y el teléfono consume la UI oficial por HTTPS con pinning TOFU.
  La app tiene cuatro clases (`MainActivity`, `SetupActivity`, `ServerStore`, `SslTrust`) y nueve
  pruebas JVM.

## Problema

`ServerStore` (168 líneas) mezclaba tres responsabilidades: persistencia de `SharedPreferences`,
normalización/validación de la URL del puente y parseo del QR y del deep link de emparejamiento; la
huella SHA-256 se construía y comparaba dentro de `SslTrust`. Esa lógica es pura y no depende del
framework, pero quedaba enterrada en clases que necesitan `Context`/`Activity`, así que solo se podía
probar indirectamente, y duplicaba conocimiento que ahora vive en el dominio del puente (origen https,
host key, formato del pin). Además, al no haber límites claros, cualquier cambio de UI arrastraba la
validación o el pinning.

## Decisiones

### 1. Android queda como adaptador delgado

La app no reimplementa el dominio del producto: su único "dominio" es presentar la UI web oficial,
recordar el servidor y decidir si confía en el certificado. No se introducen capas
dominio/aplicación/puertos como en el puente Node; se extraen objetos de valor inmutables, puros y
testeables en JVM, y las Activities siguen siendo el adaptador Android (WebView, permisos, diálogos).

**Consecuencia**: menos ceremonia y un solo adaptador real; el conocimiento de negocio (sesiones,
emparejamiento, TLS del servidor) sigue en la PC.

### 2. `ConnectionUrl`: normalización, validación https y host key

`ConnectionUrl` (paquete `com.harnessmovil.app`) modela el origen `https://host[:puerto]`:
`parse`/`normalize` aceptan la URL con o sin esquema y con ruta, query o fragmento, y devuelven el
origen canónico (host en minúsculas, puerto 443 omitido, IPv6 entre corchetes). Lanza
`IllegalArgumentException` con los mismos códigos (`empty`, `invalid`, `scheme`, `userinfo`, `host`,
`port`) que `SetupActivity` traduce a `error_url_*`. Expone `hostKey()` (`host:puerto`),
`initialUrl()` (la raíz) y `hostKeyOf`/`hostKeyFromUrl` para el pinning.

**Consecuencia**: la regla de "solo https" y la clave de host tienen una única definición; `SslTrust`
ya no reimplementa la comparación de orígenes.

### 3. `CertificatePin`: parseo, formato y comparación en tiempo constante

`CertificatePin` representa el digest SHA-256 (32 bytes). `parse` acepta hex de 64 caracteres con o
sin `:` y en cualquier caja (también espacios), `formatted()` produce el formato canónico persistido y
mostrado `AA:BB:...`, `hex()` el hex sin separadores, `matches`/`differsFrom` comparan con
`MessageDigest.isEqual` (tiempo constante) y `changed(stored, current)` encapsula la detección de
rotación (incluida una huella guardada ilegible). `fromCertificate` calcula el digest del certificado.

**Consecuencia**: `SslTrust` conserva el diálogo TOFU y sus mensajes/strings, pero delega el formato y
la comparación; el valor persistido en `cert_fingerprint` no cambia (sigue siendo `AA:BB:...`).

### 4. `PairTarget`: parsers puros de QR y deep link

`PairTarget` reemplaza `ServerStore.parseBridgeQr`/`parseDeepLink` y `ServerStore.PairInfo`:
`parseBridgeQr` acepta `https://ip:8443/_hm/#p=...` o una URL base (la URL inicial conserva el
fragmento cuando hay `/_hm/`; si no, es la raíz) y `parseDeepLink` acepta
`harnessmovil://open?base=...` o `?url=...` con `url` prioritario. Mismos formatos aceptados y mismo
`null` para entradas inválidas.

**Consecuencia**: `SetupActivity` y `MainActivity` pasan a `PairTarget`/`ConnectionUrl`; ya no hay
parsers estáticos en la clase de persistencia.

### 5. `ServerStore` solo persiste `SharedPreferences`

`ServerStore` queda con su API de persistencia intacta (`baseUrl`, `setBaseUrl`, `clearBaseUrl`,
`fingerprint`, `fingerprintHost`, `saveFingerprint`, `clearFingerprint`) y las mismas claves
(`harness_movil`, `base_url`, `cert_fingerprint`, `cert_fingerprint_host`). No cambian
`AndroidManifest.xml` ni `res/`; los mensajes de UI y el comportamiento son idénticos.

**Consecuencia**: se puede sustituir o envolver la persistencia sin tocar los objetos de valor y
viceversa; las pruebas JVM no necesitan emulador ni Robolectric.

### 6. Cuándo introducir puertos (no ahora)

La app sigue como adaptador delgado mientras haya un único servidor, un único WebView y TOFU. Se
introducirán puertos/interfaces (y probablemente un módulo de dominio propio) cuando aparezca el
segundo adaptador real:

- **Multi-servidor** (varias PCs/perfiles, selector y certificado por host): repositorio de perfiles,
  certificado por host y pantalla de selección.
- **Notificaciones** (fin de turno, aprobaciones pendientes) por FCM/WebPush: puerto de eventos y
  adaptador de notificaciones, en vez de acoplar el WebView al puente.
- **Biometría, foreground service o deep links de emparejamiento propios**: adaptadores Android que
  consuman los mismos objetos de valor.

Mientras no exista ese segundo adaptador, interfaces y capas serían ceremonia sin beneficio.

## Consecuencias

- Positivas: lógica pura testeada en JVM (39 pruebas: 9 heredadas + 30 nuevas); `ServerStore` cumple
  SRP; una sola definición de URL canónica, host key y huella; comportamiento y claves persistentes
  sin cambios; sin tocar manifest ni recursos.
- Negativas: tres archivos más y un salto de indirección al leer la configuración; `PairTarget`
  conserva la regla del path `/_hm/` mientras `ConnectionUrl` no la conoce; la app sigue sin capa de
  dominio propia, así que un segundo adaptador real exigirá un ADR nuevo con puertos.

## Verificación

- `cd android; .\gradlew.bat testDebugUnitTest --offline` → `BUILD SUCCESSFUL in 5s`,
  `21 actionable tasks: 5 executed, 16 up-to-date`.
- 39 pruebas JVM, 0 fallos (`ServerStoreTest` 9, `ConnectionUrlTest` 11, `PairTargetTest` 10,
  `CertificatePinTest` 9).
- Revisión manual: mismos formatos aceptados (URL sin esquema, `/_hm/#p=`, `harnessmovil://open`),
  mismos mensajes de UI y mismos nombres de preferencias; `AndroidManifest.xml` y `res/` sin cambios.
