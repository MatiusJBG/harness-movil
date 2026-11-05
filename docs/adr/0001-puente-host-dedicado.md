# ADR 0001 — Puente y host dedicado para usar Harness desde el teléfono

- Estado: aceptado
- Fecha: 2026-11-05
- Contexto: DeepSeek Harness `0.2.1-rc.3`, UI web oficial con manifest PWA y layout responsive,
  autenticación por token de proceso, fence de `/api` por `Host`/`Origin`, servidor web que acepta
  `--host`, `--port`, `--public-url`, `--trusted-host`, TLS nativo.

## Problema

El usuario quiere escribir en el chat y ver las respuestas de Harness desde el teléfono, manteniendo
la ejecución (archivos, comandos, herramientas) en la PC. La app de escritorio escucha en
`127.0.0.1` y no expone una forma soportada de atarse a la LAN; el token de lanzamiento no se puede
recuperar después del arranque. El servidor web de Harness no trae autenticación multiusuario ni un
flujo de emparejamiento de dispositivos.

## Decisiones

### 1. Host dedicado, no adjunción a la sesión de escritorio

El puente lanza su propio `dsh web --profile mobile` con el mismo `$DSH_HOME`. Esto usa solo
interfaces documentadas (CLI, perfil, patch, flags) y evita tocar el proceso Electron o inventar un
canal IPC.

**Consecuencia**: comparte credenciales, workspaces, skills y archivos, pero por defecto **no**
comparte el log de sesiones con la app de escritorio (ver decisión 8). No puede mantener viva la misma
sesión que la app de escritorio.

**Alternativas descartadas**: plugin dentro del host de escritorio que abra un listener propio
(superficie de seguridad no soportada, acoplada a Electron), o cliente móvil propio contra
`/connect` + `$events` (duplica el renderizado de chat/aprobaciones y depende de contratos internos).

### 2. Proxy raíz con upstream loopback

La UI se sirve en la raíz del puente (`/`) y el panel ocupa `/_hm/`. El proxy reescribe `Host` a
`127.0.0.1:<puerto>` y elimina `Origin`/`Referer`/`Sec-Fetch-*`; así el fence de Harness ve tráfico
local, no se necesita `trustedHosts` y los assets relativos (`./assets/...`) funcionan sin prefijo.

**Consecuencias**: el puente es el único punto de autenticación y puede ocultar `Set-Cookie` y la
cookie del teléfono. Los WebSocket se reenvían con `Upgrade` y la cookie de Harness inyectada.

**Alternativa descartada**: montar Harness en `/h/`; funcionaría por las URLs relativas, pero obliga
a reescribir el panel, el manifest y los redirects, sin beneficio.

### 3. La cookie de Harness queda en la PC

El puente captura el token del stdout de `dsh web` (la URL impresa puede ser la pública, así que el
token se extrae con una regex independiente del host), reserva un puerto loopback libre antes de
arrancar y hace el intercambio `GET /?token=` con `Host: 127.0.0.1:<puerto>`. La cookie firmada se
guarda en memoria y se inyecta en cada request/upgrade.

**Consecuencia**: el teléfono nunca ve el token ni la cookie de Harness; solo su cookie de
dispositivo. La revocación y el apagado son responsabilidad del puente.

### 4. Panel de administración solo loopback

El listener LAN es HTTPS; el panel de administración es HTTP en `127.0.0.1:<port+1>`. El panel no se
expone a la red y no requiere la CA (evita advertencias en la PC), mientras el teléfono usa TLS.

**Consecuencia**: cualquier proceso local puede administrar el puente; es el mismo modelo de
confianza que la app de escritorio. Se documenta.

### 5. TLS con CA local y SAN de IP

`ensureTls` genera una CA (10 años) y una hoja (397 días) con SAN para la IP LAN, hostname,
`localhost`, `127.0.0.1` y `::1`. La CA se sirve como DER en `/_hm/ca.cer`. Si cambia la IP, se
rota la hoja conservando la CA; si cambia el conjunto de SAN, se regenera la hoja.

**Consecuencias**: instalación manual de la CA en el teléfono; la cookie de dispositivo es host‑only,
así que un cambio de IP requiere re‑emparejar. Se documenta la alternativa de IP reservada o DNS.

**Alternativas descartadas**: `mkcert` (dependencia externa), Tailscale/Cloudflare (fuera del alcance
LAN de v1), HTTP plano (expondría token y cookie en tránsito).

### 6. Emparejamiento propio

Ticket de un solo uso con dos credenciales: secreto de 32 bytes (fragmento del QR) y código de 6
dígitos, TTL 5 min, rate limit 10/min/IP, máximo de dispositivos. El dispositivo recibe una cookie
propia (`hm_device`), `HttpOnly; Secure; SameSite=Lax`, y el token se guarda hasheado.

**Consecuencia**: no se depende del token de Harness para autorizar al teléfono; se puede revocar por
dispositivo y el teléfono no necesita credenciales del modelo.

### 7. Pruebas con `node:test` y shim de Vitest

El sandbox de archivos de DeepSeek Harness bloquea el `spawn` que Vite/esbuild necesita para
transformar TypeScript, así que Vitest no arranca. Las pruebas usan `node:test` con
`--test-isolation=none` (un solo proceso) y un shim mínimo de la API de Vitest
(`apps/bridge/tests/helpers/testkit.ts`), compiladas con `tsc`.

**Consecuencia**: `npm test` funciona también dentro del sandbox del agente; la cobertura se obtiene
con `--experimental-test-coverage` de Node y la duplicación con `jscpd`.

### 8. Sesiones aisladas por defecto

Harness toma un **lock de kernel por sesión** (`session/writer-held`): dos procesos no pueden escribir
la misma sesión. La app de escritorio mantiene vivas las sesiones abiertas, así que el host móvil
recibía “This session is already in use…” al intentar escribir una de ellas.

El host móvil arranca con un overlay `--patch` generado en `%LOCALAPPDATA%\harness-movil` que cambia
`session-persistence-jsonl.root` a `$DSH_HOME/sessions-mobile`. Así el teléfono tiene su propio log
append-only y nunca compite por el lock. `dsh.sessions: "shared"` desactiva el overlay de sesiones para quien
prefiera la misma lista de sesiones y acepte cerrar la sesión en escritorio primero.

El mismo overlay copia la fila `agent-default-model` del perfil `desktop`, para que el host móvil use
el mismo proveedor/modelo que la app (p. ej. `deepseek-account`) en vez de caer en una ruta de API key
sin credencial válida. Si el perfil `desktop` no define esa fila, el modelo se configura desde el
teléfono en Ajustes → Modelos.

**Alternativas descartadas**: detectar el lock (en Windows es un semáforo de kernel sin huella en
disco), borrar el lock (corrompe la sesión), o interceptar el `open` para hacer un fork transparente
(el cliente seguiría apuntando al id bloqueado).

## Verificación

- 98 pruebas unitarias/de integración (upstream falso HTTP+WS y router completo): verdes.
- Cobertura del código fuente: 90.7 % de líneas, 80.7 % de ramas y 90.8 % de funciones; duplicación 0 % (jscpd).
- E2E manual: `dsh web` real arrancado por el puente, token intercambiado, UI oficial cargada en un
  viewport móvil 360/390/430 sin scroll horizontal, WebSocket `/api/remote.mux` abierto a través del
  proxy, panel de emparejamiento y activación/desactivación funcionando.
