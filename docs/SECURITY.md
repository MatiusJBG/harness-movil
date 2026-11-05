# Modelo de seguridad

## Activos

1. **El host Harness** de la PC: puede leer/escribir archivos y ejecutar comandos como tu usuario.
2. **El token de lanzamiento** de `dsh web` y la **cookie firmada** de Harness.
3. **Los dispositivos emparejados** y sus tokens.
4. **La clave de la CA local**, que permite emitir certificados aceptados por el teléfono.

## Fronteras

| Superficie | Alcance | Autenticación |
|---|---|---|
| `https://<ip-lan>:8443/` | LAN/Wi‑Fi | cookie de dispositivo + TLS |
| `http://127.0.0.1:<adminPort>/_hm/` | solo loopback | implícita (loopback) |
| `127.0.0.1:<puerto DSH>` | solo loopback | token de proceso + cookie en memoria |

El host Harness **nunca** escucha en la LAN. El puente reescribe `Host` a
`127.0.0.1:<puerto>` y elimina `Origin`/`Referer`/`Sec-Fetch-*` antes de reenviar, de modo que el
fence de Harness ve una petición local. La cookie del teléfono no se reenvía al upstream y el
`Set-Cookie` de Harness no se reenvía al teléfono.

## Amenazas y controles

| Amenaza | Control |
|---|---|
| Alguien en la misma Wi‑Fi abre el puerto | Solo `/_hm/*` responde sin cookie; `/` y `/api/*` exigen dispositivo emparejado. |
| Fuerza bruta del código de 6 dígitos | TTL 5 min, un solo uso, límite 10/min por IP, comparación en tiempo constante. |
| Robo del QR/enlace | El secreto viaja en el fragmento (`#p=`), no se registra en logs ni en el `Referer`; se consume al emparejar. |
| Robo del teléfono emparejado | Revocación desde el panel; el token se guarda hasheado en disco; cookie `HttpOnly; Secure; SameSite=Lax`. |
| CSRF desde otra pestaña del teléfono | `Origin`/`Sec-Fetch-Site` + cabecera `X-HM-CSRF`; sin CORS. |
| DNS rebinding | El panel de admin solo escucha en loopback; la LAN exige TLS y cookie. |
| Fuga del token de Harness | El intercambio lo hace el puente contra loopback; el token vive en memoria y se redacta en logs. |
| Fuga de la cookie de Harness | Se guarda en un jar en memoria; `Set-Cookie` se elimina de las respuestas proxificadas. |
| MITM en la LAN | TLS con CA local; el teléfono debe confiar en la CA. Sin la clave de la CA, un atacante no puede emitir una hoja válida. |
| Fuerza bruta de la sesión | Cookie firmada de 90 días; revocación por dispositivo. |

## Riesgos residuales

- **La CA local es una raíz de confianza del teléfono.** Cualquiera con su clave privada puede
  emitir certificados aceptados por ese teléfono. La clave se guarda en `tls\ca-key.pem` con los
  permisos del usuario y nunca se sirve por HTTP; protegé la PC y quitá la CA del teléfono si dejás
  de usar el puente.
- **Un dispositivo emparejado es owner pleno de Harness**. Puede aprobar escrituras, ejecutar
  comandos y cambiar configuración. No hay un modo “solo chat” en v1.
- **La sesión de admin es implícita para loopback.** Cualquier proceso local que pueda abrir
  `http://127.0.0.1:8444` puede generar códigos y activar el host. Es el mismo modelo de confianza
  que la app de escritorio; no ejecutes código no confiable en tu usuario.
- **Si la PC está comprometida**, el puente no aporta protección adicional.
- **TLS sin HSTS** (autofirmado): no se envía HSTS para evitar bloquear al usuario si cambia el
  certificado.

## Recomendaciones

- Usá el firewall con perfil **Privada** y, si podés, una VLAN/SSID separada para invitados.
- Desactivá la conexión cuando no la uses (o bajá `idleAutoOffMinutes`).
- Revisá la lista de dispositivos y revocá los que no reconozcas.
- No compartas el QR ni el código; duran 5 minutos y un solo uso.
- Mantené DeepSeek Harness y el puente actualizados; fijá `dsh.command` si convivís con varias
  versiones.
- No copies `%LOCALAPPDATA%\harness-movil\tls\ca-key.pem` a otros equipos.

## Respuesta a incidentes

1. **Desactivar** la conexión desde el panel (detiene Harness).
2. **Revocar** el dispositivo afectado (o todos, borrando `devices.json` con el puente detenido).
3. Si sospechás de la CA, borrá `tls\` y reiniciá: se genera una CA nueva. Volvé a instalar el
   certificado en el teléfono y quitá la CA vieja del almacén del teléfono.
4. Revisá `logs\bridge.log` (JSON; tokens y cookies redactados).
5. Si hubo ejecución de comandos no autorizada, tratá la PC como comprometida y revisá sesiones de
   Harness, credenciales del modelo y cambios en el workspace.
