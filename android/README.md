# Harness Móvil — app Android (WebView)

Envoltorio nativo de la interfaz web oficial de DeepSeek Harness. **No reimplementa el chat**:
abre el puente de la PC en un WebView a pantalla completa, sin barra de navegador, con
pinning del certificado, subida de archivos, descargas y botón atrás del sistema.

```
App Android
  └── WebView https://<ip-lan>:8443/
        └── UI oficial de Harness (servida por el puente)
              └── host dsh web en la PC (loopback)
```

## Requisitos

- Android 8.0 (API 26) o superior.
- El puente `Harness Móvil` corriendo en la PC y la misma red Wi‑Fi.
- Para compilar: JDK 21, Android SDK (platform 35, build-tools 36) y Gradle 8.9
  (el wrapper lo descarga solo).

## Instalar

El APK de depuración queda en `android/artifacts/HarnessMovil-<versión>-debug.apk`.

Por USB:

```powershell
adb install -r android\artifacts\HarnessMovil-0.1.0-debug.apk
```

O copiá el APK al teléfono, abrilo y permití “instalar apps desconocidas” para esa fuente.

## Primer uso

1. Abrí el panel de la PC: `http://127.0.0.1:8444/_hm/` y dejá la conexión **activada**.
2. En la app, tocá **Escanear QR** y apuntá al QR del panel; o escribí `https://<ip-lan>:8443`.
3. El build copia la CA pública del puente (`%LOCALAPPDATA%\harness-movil\tls\ca.pem`) al APK,
   así que normalmente **no pide certificado**. Si usás otra PC con otra CA, aparece el diálogo de
   huella SHA‑256; verificá que coincida con la del panel y tocá **Confiar y continuar**.
4. Si el QR incluía `#p=...`, el panel de emparejamiento se abre y empareja solo; si no,
   escribí el código de 6 dígitos.
5. Tocá **Activar conexión** y después **Abrir Harness**.

El menú **⋮** de la barra superior permite recargar, cambiar servidor, abrir en navegador,
olvidar el certificado y ver la versión.

## Qué incluye

- WebView a pantalla completa con `JavaScript`, `DOM storage` y cookies del puente.
- **Pinning TOFU**: acepta el certificado autofirmado una vez, guarda la huella y avisa si cambia.
- **Escanear QR** con ZXing (cámara) para tomar la URL y el secreto de emparejamiento.
- **Subida de archivos** (`onShowFileChooser`, selección múltiple).
- **Descargas** con la cookie de sesión del WebView (export de sesión, adjuntos).
- **Atrás del sistema** navega el WebView; enlaces externos van al navegador.
- Pantalla de configuración con URL, huella del certificado y “olvidar certificado”.
- Deep link `harnessmovil://open?base=https://ip:8443` y `?url=...` para futuros QR/automatización.

### Seguridad

- La app **no guarda** el token de Harness ni credenciales del modelo: el puente las mantiene en la PC.
- La cookie de dispositivo del puente vive en el WebView (`HttpOnly; Secure; SameSite=Lax`).
- El APK incluye **solo la CA pública** del puente (no su clave privada), en un Network Security
  Config; el tráfico es HTTPS y `usesCleartextTraffic=false`.
- Si la CA del puente cambia, hay que recompilar el APK con `-CaFile`. Mientras tanto, el diálogo
  TOFU permite aceptar la nueva huella, pero los subrecursos pueden fallar hasta recompilar.
- Revocar el dispositivo desde la PC invalida la sesión de la app igual que la del navegador.

### Limitaciones actuales

- No hay notificaciones push (el WebView se pausa en segundo plano).
- El micrófono del WebView no está habilitado (no hay `onPermissionRequest`).
- El APK es **debug**; para distribución hace falta firmar un release con tu keystore.
- Depende del motor WebView del sistema (Android System WebView/Chrome actualizado).

## Compilar

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-apk.ps1
```

El script usa JDK 21, el SDK en `%LOCALAPPDATA%\Android\Sdk` y el wrapper de Gradle 8.9.
Antes de compilar copia la CA del puente (`%LOCALAPPDATA%\harness-movil\tls\ca.pem`) a
`app/src/main/res/raw/harness_ca.pem`; si usás otro directorio de datos:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-apk.ps1 -CaFile "C:\ruta\a\ca.pem"
```

La primera compilación descarga Gradle y las dependencias de AndroidX/Material/ZXing.

## Pruebas

```powershell
cd android
.\\gradlew.bat testDebugUnitTest
```n
9 pruebas JVM de ServerStore (normalización de URL, host key, QR y deep link). La UI WebView se validó
en un emulador Android 15: instalar, emparejar por QR, activar y abrir la UI oficial. El wrapper no tiene
cobertura instrumentada (JaCoCo); esa métrica corresponde al puente Node.

Estructura:

```
android/
  app/src/main/java/com/harnessmovil/app/
    MainActivity.java      WebView, menú, archivos, descargas, atrás
    SetupActivity.java     URL/QR, huella, olvidar certificado
    SslTrust.java          TOFU + diálogo de huella SHA-256
    ServerStore.java       URL base, host key y huella persistidas
  app/src/main/res/        layouts, tema, strings, ícono adaptativo
  gradle/ + gradlew*       wrapper 8.9
```

## Hoja de ruta para escalar

1. **Notificaciones** cuando termina un turno o hay una aprobación pendiente: un plugin del
   puente reenvía eventos por FCM/WebPush y la app los muestra; tocar abre la sesión.
2. **Biometría** para desbloquear la app antes de mostrar Harness.
3. **Multi-servidor** (varias PCs/perfiles) con selector y certificado por host.
4. **Deep links/QR propios** `harnessmovil://pair?...` generados por el panel.
5. **Release firmado** + GitHub Actions para compilar el APK en CI.
6. **Foreground service** opcional para mantener el WebSocket vivo mientras la app está en segundo plano.
