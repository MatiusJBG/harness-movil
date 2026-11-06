# Runbook

## Instalación desde cero

```powershell
cd C:\Users\Matius\Desktop\DeepSeek\Harness_movil
npm install --ignore-scripts
npm run build
npm start
```

Verificá que DeepSeek Harness esté instalado. El puente lo detecta en este orden:

1. `harness.command` de `config.json` si **no** es `auto` (si no existe ni está en `PATH`, falla con un error accionable).
2. Con `harness.command: "auto"`, `dsh` en `PATH`.
3. `%LOCALAPPDATA%\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd`.
4. `%ProgramFiles%\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd`.

Versión probada: `dsh 0.2.1-rc.3` (runtime Node 24.21, Electron 44.7). El puente no fija la versión;
si actualizás la app de escritorio, reiniciá el puente.

## Primer arranque

La consola muestra:

```
Panel en la PC : http://127.0.0.1:8444/_hm/
Panel en el tel: https://192.168.x.x:8443/_hm/
CA (PC)        : http://127.0.0.1:8444/_hm/ca.cer
CA (teléfono)  : https://192.168.x.x:8443/_hm/ca.cer
Código         : 123456  (vence en 5 min)
Emparejar      : https://192.168.x.x:8443/_hm/#p=...
```

Si Windows pregunta por el firewall, permití **solo redes privadas**. También podés crearlo:

```powershell
# consola como administrador
powershell -ExecutionPolicy Bypass -File scripts\firewall.ps1
```

## Instalar la CA en el teléfono

### Android

1. Abrí `https://<ip-lan>:8443/_hm/ca.cer` en Chrome.
2. “Configuración avanzada” → “Continuar” (la CA todavía no es de confianza).
3. Descargá el archivo.
4. Ajustes → Seguridad → Cifrado y credenciales → Instalar un certificado → **Certificado de CA**.
5. Elegí `harness-movil-ca.cer`.
6. Volvé a abrir `https://<ip-lan>:8443/_hm/`; ya no debe advertir.

### iPhone / iPad

1. Abrí la misma URL en **Safari**; aceptá la advertencia y descargá el perfil.
2. Ajustes → **Perfil descargado** → Instalar → Instalar.
3. Ajustes → General → Información → **Ajustes de confianza de certificados** →
   activá “Harness Movil Local CA”.
4. Reabrí la URL.

## Emparejar

1. En la PC: `http://127.0.0.1:8444/_hm/` → QR + código.
2. En el teléfono: escaneá el QR o abrí `https://<ip-lan>:8443/_hm/` y escribí el código.
3. El dispositivo aparece en “Dispositivos”.

Si el código venció, tocá **Generar código nuevo** en la PC.

## Activar / desactivar

- **Activar**: arranca `dsh web` (perfil `mobile`, `$DSH_HOME` compartido), espera la URL con token,
  hace el intercambio y deja la UI en `/`.
- **Desactivar**: detiene el host y limpia el jar. El panel sigue disponible.
- **Inactividad**: a los 30 min sin tráfico se apaga solo (`activation.idleAutoOffMinutes`).

La primera activación crea `$DSH_HOME\profiles\mobile` desde la plantilla `web`. No toca el perfil
`desktop` ni el perfil `web`.

## Instalar la PWA

Estando en `https://<ip-lan>:8443/` con la conexión activa:

- **Android/Chrome**: menú ⋮ → “Instalar aplicación” / “Agregar a la pantalla de inicio”.
- **iOS/Safari**: Compartir → “Agregar a la pantalla de inicio”.

El icono abre `/` (la UI de Harness); si la conexión está inactiva, redirige al panel.

## Arranque automático en Windows

```powershell
# consola como administrador
powershell -ExecutionPolicy Bypass -File scripts\install-task.ps1
```

Crea una tarea al iniciar sesión que ejecuta `scripts\start-hidden.vbs` (sin ventana). Para quitarla:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\uninstall-task.ps1
```

El puente **no** arranca Harness por sí solo (`activation.autoStart: false`); eso lo decidís desde el
teléfono o el panel.

## Revocar un dispositivo

Panel de la PC → **Dispositivos** → **Revocar**. El teléfono recibe 401 en la siguiente petición y
debe volver a emparejarse. Si revocás el dispositivo actual desde el teléfono, la cookie se borra.

## Cambiar la configuración

Editá `%LOCALAPPDATA%\harness-movil\config.json` y reiniciá el puente. No hay recarga en caliente.
El archivo usa `schemaVersion: 2`:

```json
{
  "schemaVersion": 2,
  "server": { "lan": { "host": "auto", "port": 8443 }, "admin": { "host": "127.0.0.1", "port": null }, "publicHost": null },
  "harness": { "command": "auto", "profile": "mobile", "home": null, "sessions": "isolated", "extraArgs": [], "startTimeoutMs": 90000 },
  "tls": { "mode": "local-ca", "certFile": null, "keyFile": null, "caFile": null },
  "pairing": { "ticketTtlSeconds": 300, "maxDevices": 3 },
  "activation": { "autoStart": false, "idleAutoOffMinutes": 30 },
  "limits": { "pairingPerMinute": 10, "maxBodyBytes": 1048576 }
}
```

- **Otro puerto**: `server.lan.port` (el admin pasa a `port + 1` salvo `server.admin.port`).
- **Otra interfaz**: `server.lan.host` con una IPv4 literal.
- **Certificado propio**: `tls.mode: "files"` + `certFile`/`keyFile` (y `caFile` opcional).
- **No apagar por inactividad**: `activation.idleAutoOffMinutes: 0`.
- **Más dispositivos**: `pairing.maxDevices`.
- **Sesiones**: `harness.sessions` (`isolated` por defecto, `shared` para la misma lista que escritorio).

### Migración desde el formato v1

Un `config.json` sin `schemaVersion` (formato v1) se migra **automáticamente** al arrancar:

1. Se respalda el original como `config.v1.json` (solo si no existe).
2. Se reescribe `config.json` con el esquema v2 de forma atómica.
3. El log registra `configuración migrada a schemaVersion 2`.

Renombres principales: `listen.*` → `server.lan.*`, `listen.adminPort` → `server.admin.port`,
`publicHost` → `server.publicHost`, `dsh.*` → `harness.*`,
`pairing.codeTtlSeconds` → `pairing.ticketTtlSeconds`.

Para validar o migrar en seco, sin arrancar los servidores:

```powershell
npm start -- --check-config
```

Claves desconocidas o una mezcla de v1 y v2 ahora **fallan con un mensaje accionable** (antes se
ignoraban). `devices.json` y la CA instalada no cambian: no hace falta re-emparejar ni reinstalar el
certificado.

## Sesiones y el lock de escritura

Harness permite **un solo escritor vivo por sesión** (lock de kernel). Si la app de escritorio tiene
una sesión abierta, otro proceso recibe “This session is already in use…” al intentar escribirla.

- **`isolated` (default)**: el host móvil usa `$DSH_HOME/sessions-mobile`; el teléfono tiene su propio
  historial y nunca choca con escritorio. No requiere hacer nada.
- **`shared`**: el host móvil usa `$DSH_HOME/sessions`; el teléfono ve las mismas sesiones, pero una
  sesión viva en escritorio sigue bloqueada hasta que la cierres ahí. Las sesiones frías se pueden
  abrir en el teléfono y quedan bloqueadas para escritorio mientras estén abiertas en el host móvil.

Para cambiar de modo: `harness.sessions` en `config.json` y reiniciar el puente.

El overlay del host móvil también copia `agent-default-model` del perfil `desktop`, así el teléfono usa el mismo proveedor/modelo que la app. Si el perfil `desktop` no lo define, configurá el modelo en Ajustes → Modelos desde el teléfono.

## Diagnóstico

| Síntoma | Causa probable | Solución |
|---|---|---|
| `spawn EPERM` en el panel | El proceso corre dentro de un sandbox que bloquea `spawn` | Ejecutá el puente fuera del sandbox (o con acceso completo) |
| `EADDRINUSE` al arrancar | Otro proceso usa 8443/8444 | Cambiá `server.lan.port` |
| El teléfono no conecta | Firewall / otra red / IP incorrecta | Regla de firewall Privada; verificá la IP en el panel |
| Advertencia de certificado | CA no instalada o IP cambió | Instalá la CA; si cambió la IP, reiniciá y re‑emparejá |
| 401 en el teléfono | Dispositivo revocado o cookie de otro host | Volvé a emparejar |
| 503 en `/api/*` o `harness-inactive` en el panel | Conexión desactivada o host arrancando | Activá y esperá el estado `active` |
| UI en blanco | Proxy sin upstream o versión incompatible | Mirá `logs\bridge.log`; verificá `dsh --version` |
| La sesión no abre / “already in use” | La sesión está viva en otro proceso (app de escritorio) | Con `isolated` no pasa; con `shared`, cerrá esa sesión en escritorio o usá otra |
| `config.json inválido` al arrancar | Clave desconocida o mezcla v1/v2 | Corregí según el mensaje, o restaurá `config.v1.json` |
| QR vencido | TTL 5 min | Generá uno nuevo |
| “Demasiados intentos” | Rate limit | Esperá un minuto |

Logs: `%LOCALAPPDATA%\harness-movil\logs\bridge.log` (JSON lines, secretos redactados).
Subí `HARNESS_MOVIL_LOG_LEVEL=debug` para más detalle.

## Reset

Con el puente detenido:

- **Olvidar dispositivos**: borrá `devices.json`.
- **Regenerar la CA**: borrá la carpeta `tls\` (el teléfono deberá reinstalar la CA).
- **Todo**: borrá `%LOCALAPPDATA%\harness-movil`.

## Desinstalar

1. `scripts\uninstall-task.ps1`.
2. Quitá la regla de firewall (el script `firewall.ps1 -Remove`).
3. Borrá `%LOCALAPPDATA%\harness-movil`.
4. En el teléfono, quitá la CA instalada y desinstalá la PWA.