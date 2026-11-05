import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join, normalize } from 'node:path'
import QRCode from 'qrcode'
import type { Activation } from './activation.js'
import {
  BodyTooLargeError,
  CSRF_HEADER,
  DEVICE_COOKIE,
  RateLimiter,
  getCookie,
  readJsonBody,
  requestIp,
  sameOriginOk,
  sendJson,
  sendText,
  serializeClearedDeviceCookie,
  serializeDeviceCookie,
} from './auth.js'
import type { ResolvedConfig } from './config.js'
import { DeviceLimitError, sanitizeDeviceName, type DeviceStore, type PublicDevice } from './devices.js'
import type { Logger } from './log.js'
import type { PairingService } from './pairing.js'
import type { TlsMaterial } from './tls.js'

export interface DashboardOptions {
  config: ResolvedConfig
  devices: DeviceStore
  pairing: PairingService
  activation: Activation
  tls: TlsMaterial
  logger: Logger
  publicDir: string
  version: string
}

interface StaticAsset {
  body: Buffer
  type: string
}

export interface Dashboard {
  handle(req: IncomingMessage, res: ServerResponse, adminListener?: boolean): Promise<void>
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

export async function createDashboard(options: DashboardOptions): Promise<Dashboard> {
  const assets = new Map<string, StaticAsset>()
  for (const name of ['index.html', 'app.js', 'styles.css', 'icon.svg']) {
    const file = join(options.publicDir, name)
    if (!existsSync(file)) continue
    const extension = name.slice(name.lastIndexOf('.'))
    assets.set(name, { body: await readFile(file), type: CONTENT_TYPES[extension] ?? 'application/octet-stream' })
  }
  if (!assets.has('index.html')) {
    throw new Error(`Falta el panel del puente: ${join(options.publicDir, 'index.html')}`)
  }

  const pairingLimiter = new RateLimiter(options.config.config.limits.pairingPerMinute, 60_000)
  const logger = options.logger.child({ component: 'dashboard' })
  const now = () => new Date()

  const handle = async (req: IncomingMessage, res: ServerResponse, adminListener = false): Promise<void> => {
    applySecurityHeaders(res)
    const url = new URL(req.url ?? '/', `https://${req.headers.host ?? 'localhost'}`)
    const path = url.pathname
    const admin = adminListener
    const device = options.devices.authenticate(getCookie(req, DEVICE_COOKIE), requestIp(req))
    const authenticated = admin || device !== null

    if (req.method === 'GET' || req.method === 'HEAD') {
      const asset = staticAssetFor(path, assets)
      if (asset) {
        res.writeHead(200, {
          'content-type': asset.type,
          'cache-control': path === '/_hm/index.html' || path === '/_hm/' ? 'no-store' : 'public, max-age=300',
          'content-length': asset.body.length,
        })
        res.end(req.method === 'HEAD' ? undefined : asset.body)
        return
      }
    }

    if (path === '/_hm/api/session' && req.method === 'GET') {
      sendJson(res, 200, {
        paired: device !== null,
        admin,
        active: options.activation.isActive(),
        state: options.activation.state,
        device: device ? { id: device.id, name: device.name } : null,
      })
      return
    }

    if (path === '/_hm/api/pair' && req.method === 'POST') {
      if (!sameOriginOk(req)) {
        sendJson(res, 403, { error: 'Origen no permitido.' })
        return
      }
      if (req.headers[CSRF_HEADER] !== '1') {
        sendJson(res, 403, { error: 'Falta el encabezado anti-CSRF.' })
        return
      }
      const ip = requestIp(req)
      if (!pairingLimiter.tryConsume(ip)) {
        sendJson(res, 429, { error: 'Demasiados intentos de emparejamiento. Esperá un minuto.' })
        return
      }
      let body: { code?: unknown; secret?: unknown; name?: unknown }
      try {
        body = (await readJsonBody(req, options.config.config.limits.maxBodyBytes)) as typeof body
      } catch (error) {
        const status = error instanceof BodyTooLargeError ? 413 : 400
        sendJson(res, status, { error: error instanceof Error ? error.message : 'Pedido inválido.' })
        return
      }
      const code = typeof body.code === 'string' ? body.code : ''
      const secret = typeof body.secret === 'string' ? body.secret : ''
      if (!options.pairing.verify({ code, secret })) {
        logger.warn('intento de emparejamiento rechazado', { ip })
        sendJson(res, 401, { error: 'El código no es válido o ya venció. Pedí uno nuevo en la PC.' })
        return
      }
      try {
        const created = await options.devices.add({
          name: sanitizeDeviceName(body.name),
          ip,
          maxDevices: options.config.config.pairing.maxDevices,
        })
        options.pairing.consume()
        pairingLimiter.reset(ip)
        logger.info('dispositivo emparejado', { deviceId: created.device.id, ip })
        sendJson(
          res,
          200,
          { device: created.device },
          { 'set-cookie': serializeDeviceCookie(created.token) },
        )
      } catch (error) {
        if (error instanceof DeviceLimitError) {
          sendJson(res, 409, { error: error.message })
          return
        }
        throw error
      }
      return
    }

    if (path === '/_hm/ca.cer' && req.method === 'GET') {
      if (!options.tls.caDer) {
        sendJson(res, 404, { error: 'El certificado se configuró con archivos externos; usá /_hm/ca.pem.' })
        return
      }
      res.writeHead(200, {
        'content-type': 'application/x-x509-ca-cert',
        'content-disposition': 'attachment; filename="harness-movil-ca.cer"',
        'content-length': options.tls.caDer.length,
        'cache-control': 'no-store',
      })
      res.end(options.tls.caDer)
      return
    }

    if (path === '/_hm/ca.pem' && req.method === 'GET') {
      if (!options.tls.caPem) {
        sendJson(res, 404, { error: 'No hay CA local disponible.' })
        return
      }
      sendText(res, 200, options.tls.caPem, 'application/x-pem-file; charset=utf-8')
      return
    }

    if (!authenticated && path.startsWith('/_hm/api/')) {
      sendJson(res, 401, { error: 'Este dispositivo no está emparejado.' })
      return
    }

    if (!authenticated) {
      sendJson(res, 401, { error: 'Este dispositivo no está emparejado.' })
      return
    }

    if (path === '/_hm/api/status' && req.method === 'GET') {
      sendJson(res, 200, statusBody())
      return
    }

    if (path === '/_hm/api/activate' && req.method === 'POST') {
      if (!guardMutation(req, res)) return
      if (!options.activation.isActive() && options.activation.state !== 'starting') {
        void options.activation.activate().catch((error: unknown) => {
          logger.error('falló la activación', { error: error instanceof Error ? error.message : String(error) })
        })
      }
      sendJson(res, 202, options.activation.snapshot())
      return
    }

    if (path === '/_hm/api/deactivate' && req.method === 'POST') {
      if (!guardMutation(req, res)) return
      await options.activation.deactivate('phone')
      sendJson(res, 200, options.activation.snapshot())
      return
    }

    if (path === '/_hm/api/pairing' && req.method === 'GET') {
      if (!admin) {
        sendJson(res, 403, { error: 'Solo la PC puede generar códigos de emparejamiento.' })
        return
      }
      const ticket = options.pairing.current() ?? options.pairing.issue(options.config.config.pairing.codeTtlSeconds * 1_000)
      sendJson(res, 200, await pairingView(ticket))
      return
    }

    if (path === '/_hm/api/pairing/refresh' && req.method === 'POST') {
      if (!admin) {
        sendJson(res, 403, { error: 'Solo la PC puede generar códigos de emparejamiento.' })
        return
      }
      if (!guardMutation(req, res)) return
      const ticket = options.pairing.issue(options.config.config.pairing.codeTtlSeconds * 1_000)
      logger.info('nuevo código de emparejamiento generado')
      sendJson(res, 200, await pairingView(ticket))
      return
    }

    if (path === '/_hm/api/devices' && req.method === 'GET') {
      const all = options.devices.list()
      sendJson(res, 200, { devices: admin ? all : all.filter((entry) => entry.id === device?.id), admin })
      return
    }

    if (path.startsWith('/_hm/api/devices/') && req.method === 'DELETE') {
      if (!guardMutation(req, res)) return
      const id = decodeURIComponent(path.slice('/_hm/api/devices/'.length))
      if (!admin && device?.id !== id) {
        sendJson(res, 403, { error: 'No podés revocar otro dispositivo.' })
        return
      }
      const revoked = await options.devices.revoke(id)
      if (!revoked) {
        sendJson(res, 404, { error: 'Dispositivo inexistente o ya revocado.' })
        return
      }
      logger.info('dispositivo revocado', { deviceId: id })
      const headers: Record<string, string> = {}
      if (!admin && device?.id === id) headers['set-cookie'] = serializeClearedDeviceCookie()
      sendJson(res, 200, { revoked: true }, headers)
      return
    }

    if (path === '/_hm/api/logout' && req.method === 'POST') {
      if (!guardMutation(req, res)) return
      if (device) await options.devices.revoke(device.id)
      sendJson(res, 200, { ok: true }, { 'set-cookie': serializeClearedDeviceCookie() })
      return
    }

    if (path === '/_hm/api/diagnostics' && req.method === 'GET') {
      if (!admin) {
        sendJson(res, 403, { error: 'Diagnóstico disponible solo desde la PC.' })
        return
      }
      sendJson(res, 200, {
        version: options.version,
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
        dataDir: options.config.dataDir,
        dshHome: options.config.dshHome,
        profile: options.config.config.dsh.profile,
        command: options.config.config.dsh.command,
        sessions: options.config.config.dsh.sessions,
        bind: `${options.config.bindHost}:${options.config.port}`,
        admin: `${options.config.adminAuthority}`,
        tls: { notAfter: options.tls.notAfter.toISOString(), sans: options.tls.sans },
      })
      return
    }

    sendJson(res, 404, { error: 'No encontrado.' })
  }

  function statusBody(): Record<string, unknown> {
    const snapshot = options.activation.snapshot()
    return {
      ...snapshot,
      network: {
        publicUrl: options.config.publicUrl,
        adminUrl: options.config.adminUrl,
        authority: options.config.authority,
        lanHost: options.config.lanHost,
      },
      cert: {
        notAfter: options.tls.notAfter.toISOString(),
        fingerprint: options.tls.fingerprint,
        sans: options.tls.sans,
      },
      sessions: {
        mode: options.config.config.dsh.sessions,
        root: join(
          options.config.dshHome,
          options.config.config.dsh.sessions === 'shared' ? 'sessions' : 'sessions-mobile',
        ),
      },
      pairedDevices: options.devices.activeCount(),
      version: options.version,
      now: now().toISOString(),
    }
  }

  async function pairingView(ticket: { code: string; secret: string; expiresAt: number }): Promise<Record<string, unknown>> {
    const url = `${options.config.publicUrl}_hm/#p=${encodeURIComponent(ticket.secret)}`
    const qrDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 480, errorCorrectionLevel: 'M' })
    return {
      code: ticket.code,
      expiresAt: new Date(ticket.expiresAt).toISOString(),
      url,
      qrDataUrl,
    }
  }

  return { handle }
}

function staticAssetFor(path: string, assets: Map<string, StaticAsset>): StaticAsset | null {
  const name = path === '/_hm/' || path === '/_hm' ? 'index.html' : normalize(path.slice('/_hm/'.length))
  if (name.includes('..') || name.startsWith('/')) return null
  return assets.get(name) ?? null
}

function guardMutation(req: IncomingMessage, res: ServerResponse): boolean {
  if (!sameOriginOk(req)) {
    sendJson(res, 403, { error: 'Origen no permitido.' })
    return false
  }
  if (req.headers[CSRF_HEADER] !== '1') {
    sendJson(res, 403, { error: 'Falta el encabezado anti-CSRF.' })
    return false
  }
  return true
}

function applySecurityHeaders(res: ServerResponse): void {
  res.setHeader('x-content-type-options', 'nosniff')
  res.setHeader('referrer-policy', 'no-referrer')
  res.setHeader('x-frame-options', 'DENY')
  res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()')
  res.setHeader(
    'content-security-policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  )
}
