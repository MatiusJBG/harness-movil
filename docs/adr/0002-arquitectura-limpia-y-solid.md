# ADR 0002 — Clean Architecture y SOLID estricto en el puente

- Estado: aceptado
- Fecha: 2026-11-05
- Contexto: Harness Móvil `0.1.0`, Node.js 22+, un solo desplegable (puente + panel) y una app
  Android que consume el panel servido por el puente.

## Problema

El puente funcionaba, pero su código estaba organizado por capa técnica: `config`, `tls`,
`devices`, `pairing`, `dsh`, `jar`, `activation`, `proxy`, `auth`, `dashboard`, `http`,
`log`, `version` y `main`. Ese esquema produjo:

- Ocho módulos con entre 4 y 9 razones de cambio (`dsh.ts` 431 líneas, `dashboard.ts` 362).
- Lógica de acceso duplicada en `handle` y `handleUpgrade`.
- Puertos inconsistentes (`Pick<DshSupervisor, …> | SupervisorLike` y un cast `jar as JarLike`).
- `ResolvedConfig` con 16 campos atravesando seis módulos.
- Un **TOCTOU real** en el emparejamiento: verificar el ticket, esperar el alta y recién después
  consumirlo permitía canjear el mismo ticket dos veces.
- Pruebas obligadas a construir todo el grafo (HTTP + TLS + disco) para validar una regla.

Sin fronteras verificables, cualquier contribución futura podía reintroducir el acoplamiento sin que
ninguna herramienta lo detectara.

## Decisión

### 1. Cuatro capas concéntricas y una regla de dependencia ejecutable

```
domain  ←  application  ←  adapters / config / cli  ←  composition  ←  main
```

- **domain**: entidades y reglas puras (dispositivo, ticket, máquina de estados, token de
  arranque, SAN). Sin `node:*` ni paquetes.
- **application**: puertos + casos de uso + errores tipados + orquestador de activación.
  Solo depende de `domain` y de sus propios puertos.
- **adapters**: implementaciones concretas (JSON en disco, `node:crypto`, `node-forge`,
  `http-proxy`, `qrcode`, router/controladores/presentadores HTTP, logger, versión).
- **config**: esquema zod v2, migración v1→v2, resolución de red.
- **composition**: única raíz que conoce implementaciones (runtime + wiring + listeners); `main` solo CLI, arranque y apagado.

Regla aplicada por **dependency-cruiser** con severidad `error`: `domain-no-exterior`,
`domain-no-core`, `application-no-exterior`, `application-no-core`,
`adapters-no-other-family` (solo `adapters/shared` es transversal), `config-no-adapters`,
`main-no-adapters` (el entry solo compone), `no-circular`, `no-import-main` y `no-orphans`.
Nota: `no-orphans` de dependency-cruiser detecta módulos sin dependencias **y** sin dependientes; la
conectividad de un módulo que sí importa se revisa a mano (no hay regla de exports sin uso).

### 2. Puertos explícitos en la frontera de aplicación

`Clock`, `Logger`, `DeviceRepository` (`DeviceQueries` + `DeviceMutations`),
`SecretHasher`, `IdGenerator`, `PairingTicketStore`, `HarnessSupervisor`,
`SessionCookieStore`, `TlsMaterialProvider`, `RateLimiter`, `Scheduler`, `ActivationReader` /
`ActivationControl` / `ActivityMarker` y `AppSettings` por *slices*.

`Scheduler` vive en `application/ports/scheduler.ts` y es **obligatorio** en `ActivationOptions`:
la aplicación no usa `setInterval` global. El adaptador real es
`adapters/runtime/node-scheduler.ts` y lo inyecta composición (los tests, un doble).

El puerto del proxy HTTP/WS vive en `adapters/http/proxy` porque su contrato habla el protocolo de
Node (`IncomingMessage`, `Duplex`); meterlo en aplicación habría obligado a importar `node:http`
desde una capa interna. Se documenta como excepción deliberada.

### 3. SOLID aplicado, no declamado

- **S**: un archivo = una razón de cambio; `max-lines` 300 y `max-lines-per-function` 80. Los ocho
  módulos monolíticos se descompusieron (ver tabla de mapeo en el plan). `auth.ts` →
  presentadores + middleware + `MemoryRateLimiter`; `dsh.ts` → localizador, args, overlay,
  supervisor, kill tree y puerto libre; `dashboard.ts` → nueve controladores + manifiesto de assets.
- **O**: el router dejó de ser una cadena de `if`. `route-table.ts` declara cada endpoint con
  `access`, `mutation` y `rateLimit`; añadir una ruta es añadir una fila. Los errores se traducen
  en un único `error-mapper.ts`.
- **L**: se eliminaron las uniones y el cast; cada rol tiene **un** puerto. Los tests de contrato
  cubren las implementaciones reales (repositorio JSON, hasher SHA-256, limitador, tickets).
- **I**: `DashboardOptions` (8) desapareció y `RouterOptions` quedó reducido a cuatro
  colaboradores (rutas, autenticación, limitador y logger); `ResolvedConfig` se partió en
  `DataPaths`, `NetworkSettings`, `HarnessSettings`, `PairingSettings`, `ActivationSettings`,
  `LimitsSettings` y `TlsSettings`. La activación se expone como tres interfaces mínimas.
- **D**: reloj, logger, hasher, generador de ids, persistencia, supervisor, cookie, TLS, rate
  limiter, scheduler y assets entran por puerto. La composición tiene dos piezas:
  `composition/build-runtime.ts` (reloj, logger, TLS, versión y SAN del certificado) y
  `composition/wiring.ts` (grafo de aplicación reutilizable, con overrides para los tests). `main.ts`
  solo usa `cli`, `composition` y `config/loader`; ya no instancia adaptadores. `version.ts` dejó de
  leer `package.json` desde una capa interna.

### 4. Canje de ticket atómico

`PairingTicketStore.redeem(input, nowMs)` verifica y consume en el mismo tick, **antes** de
cualquier `await`. Dos pedidos concurrentes ya no pueden emparejar dos dispositivos con un ticket.
Si la persistencia falla después del canje, el ticket se pierde (se documenta en el error y el
usuario genera otro).

### 5. Configuración v2 con migración automática

`schemaVersion: 2` agrupa `server.lan`/`server.admin`/`server.publicHost`, `harness.*`,
`tls`, `pairing.ticketTtlSeconds`, `activation` y `limits`. Un archivo v1 se migra al arrancar,
se respalda como `config.v1.json` y se escribe de forma atómica. Mezclas v1/v2, versiones
desconocidas y claves no reconocidas fallan con código accionable. `--check-config` permite migrar
en seco. `devices.json` (v1) y el directorio TLS **no** cambian: migrarlos obligaría a re-emparejar
todos los teléfonos y a reinstalar la CA sin beneficio funcional.

### 6. API del panel v1

Los endpoints JSON pasan a `/_hm/api/v1/*` con errores uniformes
`{ error: { code, message } }`. Se conservan sin cambios `/_hm/`, el fragmento `#p=<secreto>`,
`/_hm/ca.cer` y `/_hm/ca.pem` porque los consumen QR ya impresos, teléfonos emparejados y el APK
instalado (que no llama a la API JSON). Las rutas v0 se retiraron: su único cliente es el panel que
sirve el propio puente.

### 6.1 Endurecimiento HTTP

- **Admin solo loopback.** `server.admin.host` acepta únicamente `127.0.0.1` o `::1`; otro valor
  falla con `ConfigError` (`config-invalid`). Además, el listener admin exige que el pedido venga
  de loopback y que el `Host` sea el del panel (`127.0.0.1:puerto`, `localhost:puerto`,
  `[::1]:puerto`), tanto en HTTP como en `upgrade` (DNS rebinding).
- **Cross-site en el proxy.** Las rutas proxeadas exigen same-origin cuando el pedido trae
  `Origin` (sin `Origin` se permite: cliente no navegador); el `upgrade` WS aplica la misma
  comprobación. No se agrega `X-HM-CSRF` al proxy para no romper la UI oficial.
- **Métodos del proxy.** `GET/HEAD/POST/PUT/PATCH/DELETE/OPTIONS` (HEAD se atiende con la fila GET,
  sin rutas duplicadas). PUT/PATCH/OPTIONS usan los mismos guards que POST.
- **CSP con alcance de panel.** Las cabeceras de seguridad se aplican solo a `/_hm/*`; las
  respuestas proxeadas conservan las de Harness.
- **Robustez.** El parseo de cookies es total (una cookie malformada equivale a no emparejado) y el
  `upgrade` va envuelto en try/catch para no tumbar el proceso.

### 7. Pruebas por capa y puertas de calidad

- 168 pruebas: dominio (puro), aplicación con dobles, contratos de adaptadores, configuración
  (migración incluida), integración HTTP/WS con upstream falso y arquitectura en banda.
- `npm run verify` = typecheck + lint + arch + tests; `pretest` ejecuta `arch`, de modo que
  ningún `npm test` puede evadir las fronteras.
- Cobertura: 87.4 % líneas, 86.2 % ramas, 88.3 % funciones (umbral 85/65/80).
- Duplicación jscpd: 0 % (`--threshold 0`) sobre `apps`, `android/app/src` y `scripts`, sin tests.
- `npm run metrics:new` ejecuta primero `test:coverage` y falla si `coverage/lcov.info` no existe,
  es anterior al commit `HEAD` o no pertenece a este árbol; los archivos cambiados para la
  duplicación nueva salen de `git diff --name-only base...HEAD` (incluye `public/js` y Java).

## Consecuencias

- Más archivos (93 en `src`) pero cada uno con un propósito único; el grafo se valida en cada
  `npm test`.
- Los casos de uso se prueban sin red ni disco; la integración queda para HTTP/WS.
- `npm run metrics:new` entrega cobertura de líneas nuevas y duplicación nueva.
- Coste aceptado: una capa de indirección (puertos + composición) para cada efecto externo.
- Si aparece un segundo consumidor del dominio (CLI compartida, app Android nativa con más lógica),
  `src/domain` se extrae a `packages/domain` sin cambiar la regla de dependencia.

## Verificación

```
npm run verify   # typecheck + lint + arch + 168 tests
npm run test:coverage
npm run dup
npm run metrics:new -- --base=main
```

E2E manual: arranque con un `config.json` v1 real → migración a v2 con `config.v1.json`, panel,
CA, emparejamiento por código, cookie de dispositivo, `/_hm/api/v1/status` y diagnóstico desde la PC.

## Referencias

- [ADR 0001 — Puente y host dedicado](0001-puente-host-dedicado.md).
- [ADR 0003 — Android como adaptador delgado](0003-android-adaptador-delgado.md).
