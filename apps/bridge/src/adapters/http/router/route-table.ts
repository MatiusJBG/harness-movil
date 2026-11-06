import type { RouteDefinition } from './route-definition.js'
import type { createActivationController } from '../controllers/activation-controller.js'
import type { createAssetsController } from '../controllers/assets-controller.js'
import type { createCaController } from '../controllers/ca-controller.js'
import type { createDevicesController } from '../controllers/devices-controller.js'
import type { createDiagnosticsController } from '../controllers/diagnostics-controller.js'
import type { createPairingController } from '../controllers/pairing-controller.js'
import type { createProxyController } from '../controllers/proxy-controller.js'
import type { createSessionController } from '../controllers/session-controller.js'
import type { createStatusController } from '../controllers/status-controller.js'

export interface RouteControllers {
  readonly session: ReturnType<typeof createSessionController>
  readonly pairing: ReturnType<typeof createPairingController>
  readonly devices: ReturnType<typeof createDevicesController>
  readonly activation: ReturnType<typeof createActivationController>
  readonly status: ReturnType<typeof createStatusController>
  readonly diagnostics: ReturnType<typeof createDiagnosticsController>
  readonly ca: ReturnType<typeof createCaController>
  readonly assets: ReturnType<typeof createAssetsController>
  readonly proxy: ReturnType<typeof createProxyController>
}

/**
 * Tabla de rutas: añadir un endpoint es añadir una fila; el router no cambia.
 * `access` es obligatorio por tipo, así una ruta nueva no puede quedar pública
 * por olvido.
 */
export function createRouteTable(controllers: RouteControllers): RouteDefinition[] {
  return [
    {
      method: 'GET',
      pattern: '/_hm',
      access: 'public',
      mutation: false,
      handle: (ctx): void => {
        ctx.res.writeHead(302, { location: '/_hm/', 'content-length': 0 })
        ctx.res.end()
      },
    },
    { method: 'GET', pattern: '/_hm/api/v1/session', access: 'public', mutation: false, handle: controllers.session.read },
    {
      method: 'POST',
      pattern: '/_hm/api/v1/session/pairing',
      access: 'public',
      mutation: true,
      rateLimit: 'pairing',
      handle: controllers.pairing.claim,
    },
    { method: 'DELETE', pattern: '/_hm/api/v1/session', access: 'paired', mutation: true, handle: controllers.session.signOut },
    { method: 'GET', pattern: '/_hm/api/v1/pairing/ticket', access: 'admin', mutation: false, handle: controllers.pairing.read },
    { method: 'POST', pattern: '/_hm/api/v1/pairing/ticket', access: 'admin', mutation: true, handle: controllers.pairing.refresh },
    { method: 'GET', pattern: '/_hm/api/v1/devices', access: 'paired', mutation: false, handle: controllers.devices.list },
    { method: 'DELETE', pattern: '/_hm/api/v1/devices/:id', access: 'paired', mutation: true, handle: controllers.devices.revoke },
    { method: 'GET', pattern: '/_hm/api/v1/activation', access: 'paired', mutation: false, handle: controllers.activation.read },
    { method: 'POST', pattern: '/_hm/api/v1/activation', access: 'paired', mutation: true, handle: controllers.activation.activate },
    { method: 'DELETE', pattern: '/_hm/api/v1/activation', access: 'paired', mutation: true, handle: controllers.activation.deactivate },
    { method: 'GET', pattern: '/_hm/api/v1/status', access: 'paired', mutation: false, handle: controllers.status.read },
    { method: 'GET', pattern: '/_hm/api/v1/diagnostics', access: 'admin', mutation: false, handle: controllers.diagnostics.read },
    { method: 'GET', pattern: '/_hm/api/v1/tls/ca.der', access: 'public', mutation: false, handle: controllers.ca.der },
    { method: 'GET', pattern: '/_hm/api/v1/tls/ca.pem', access: 'public', mutation: false, handle: controllers.ca.pem },
    // Compatibilidad con teléfonos y APK ya instalados: estas dos rutas no cambian.
    { method: 'GET', pattern: '/_hm/ca.cer', access: 'public', mutation: false, handle: controllers.ca.der },
    { method: 'GET', pattern: '/_hm/ca.pem', access: 'public', mutation: false, handle: controllers.ca.pem },
    { method: 'GET', pattern: '/_hm/*', access: 'public', mutation: false, handle: controllers.assets.get },
    // Todo lo demás es la UI oficial de Harness a través del proxy. HEAD se atiende con GET.
    // `sameOrigin` bloquea navegadores de otro origen; un cliente sin `Origin` pasa.
    { method: 'GET', pattern: '/*', access: 'paired', mutation: false, sameOrigin: true, handle: controllers.proxy.handle },
    { method: 'POST', pattern: '/*', access: 'paired', mutation: false, sameOrigin: true, handle: controllers.proxy.handle },
    { method: 'PUT', pattern: '/*', access: 'paired', mutation: false, sameOrigin: true, handle: controllers.proxy.handle },
    { method: 'PATCH', pattern: '/*', access: 'paired', mutation: false, sameOrigin: true, handle: controllers.proxy.handle },
    { method: 'DELETE', pattern: '/*', access: 'paired', mutation: false, sameOrigin: true, handle: controllers.proxy.handle },
    { method: 'OPTIONS', pattern: '/*', access: 'paired', mutation: false, sameOrigin: true, handle: controllers.proxy.handle },
  ]
}