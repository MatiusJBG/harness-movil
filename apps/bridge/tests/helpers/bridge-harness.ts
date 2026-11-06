import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import type { DeviceRepository } from '../../src/application/ports/device-repository.js'
import type { Scheduler } from '../../src/application/ports/scheduler.js'
import type { AppSettings } from '../../src/application/ports/settings.js'
import type { TlsMaterial } from '../../src/application/ports/tls-material-provider.js'
import type { PairingTicket } from '../../src/domain/pairing/pairing-ticket.js'
import type { PairDeviceInput, PairDeviceResult } from '../../src/application/use-cases/pair-device.js'
import type { Activation } from '../../src/application/use-cases/activation.js'
import { createDevice } from '../../src/domain/device/device.js'
import { createAdminServer } from '../../src/adapters/http/server/admin-server.js'
import { JsonDeviceRepository } from '../../src/adapters/persistence/json-device-repository.js'
import { Sha256SecretHasher } from '../../src/adapters/security/sha256-secret-hasher.js'
import { wireApplication } from '../../src/composition/wiring.js'
import { createFakeClock, createFakeCookies, createFakeLogger, createFakeSupervisor, FIXED_NOW_MS } from './fakes.js'
import { startFakeUpstream, TEST_COOKIE, type FakeUpstream } from './fake-upstream.js'
import { makeTempDir, removeTempDir } from './fs.js'

export const PUBLIC_DIR = join(process.cwd(), 'apps', 'bridge', 'public')
export const DEVICE_TOKEN = 'device-1.secret-1'
export const LAUNCH_TOKEN = 'v1.abc'

export interface HarnessOptions {
  readonly maxDevices?: number
  readonly pairingPerMinute?: number
  readonly tls?: TlsMaterial
  readonly idleAutoOffMinutes?: number
}

export interface TestResponse {
  readonly status: number
  readonly headers: Headers
  readonly text: string
  readonly json: Record<string, unknown>
  readonly cookie: string | null
}

export interface TestBridge {
  readonly settings: AppSettings
  readonly activation: Activation
  readonly devices: DeviceRepository
  readonly supervisor: ReturnType<typeof createFakeSupervisor>
  readonly clock: ReturnType<typeof createFakeClock>
  readonly upstream: FakeUpstream
  readonly tls: TlsMaterial
  readonly lanPort: number
  readonly adminPort: number
  ticket(): PairingTicket
  pair(input: PairDeviceInput): Promise<PairDeviceResult>
  call(
    listener: 'lan' | 'admin',
    path: string,
    options?: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string> },
  ): Promise<TestResponse>
  wsStatus(url: string, headers: Record<string, string>): Promise<number>
  close(): Promise<void>
}

function fakeTls(): TlsMaterial {
  return {
    certPem: 'cert',
    keyPem: 'key',
    caPem: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n',
    caDer: Buffer.from('der'),
    notAfter: new Date(FIXED_NOW_MS + 86_400_000),
    fingerprint: 'abc',
    sans: ['127.0.0.1'],
    reused: true,
  }
}

/** Temporizador inerte: la integración no depende de relojes reales. */
const INERT_SCHEDULER: Scheduler = {
  setInterval: () => 0,
  clearInterval: () => undefined,
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (typeof address === 'object' && address !== null) resolve(address.port)
      else reject(new Error('sin puerto'))
    })
  })
}

export async function startBridge(options: HarnessOptions = {}): Promise<TestBridge> {
  const dir = await makeTempDir('bridge-')
  const upstream = await startFakeUpstream()
  const clock = createFakeClock()
  const logger = createFakeLogger()
  const settings: AppSettings = {
    paths: {
      dataDir: dir,
      configFile: join(dir, 'config.json'),
      tlsDir: join(dir, 'tls'),
      devicesFile: join(dir, 'devices.json'),
      logDir: join(dir, 'logs'),
      dshHome: join(dir, 'home'),
    },
    network: {
      bindHost: '127.0.0.1',
      lanHost: '127.0.0.1',
      publicHost: '127.0.0.1',
      port: 19_443,
      adminHost: '127.0.0.1',
      adminPort: 19_444,
      authority: '127.0.0.1:19443',
      adminAuthority: '127.0.0.1:19444',
      publicUrl: 'https://127.0.0.1:19443/',
      adminUrl: 'http://127.0.0.1:19444/_hm/',
    },
    harness: {
      command: 'auto',
      profile: 'mobile',
      home: null,
      sessions: 'isolated',
      extraArgs: [],
      startTimeoutMs: 90_000,
    },
    pairing: { ticketTtlSeconds: 300, maxDevices: options.maxDevices ?? 3 },
    activation: { autoStart: false, idleAutoOffMinutes: options.idleAutoOffMinutes ?? 0 },
    limits: { pairingPerMinute: options.pairingPerMinute ?? 10, maxBodyBytes: 4_096 },
    tls: { mode: 'local-ca', certFile: null, keyFile: null, caFile: null },
  }
  const tls = options.tls ?? fakeTls()

  const devices = new JsonDeviceRepository({ file: settings.paths.devicesFile, clock })
  await devices.load()
  const supervisor = createFakeSupervisor({
    pid: 4242,
    port: upstream.port,
    token: LAUNCH_TOKEN,
    startedAt: FIXED_NOW_MS,
    command: 'dsh',
  })
  const cookies = createFakeCookies()
  const hasher = new Sha256SecretHasher()
  await devices.add(
    createDevice({ id: 'device-1', name: 'Test Phone', tokenHash: hasher.hash('secret-1'), ip: '127.0.0.1', timestamp: new Date(FIXED_NOW_MS).toISOString() }),
  )

  const app = await wireApplication({
    settings,
    logger,
    clock,
    tls,
    version: 'test',
    publicDir: PUBLIC_DIR,
    scheduler: INERT_SCHEDULER,
    overrides: { devices, supervisor, cookies },
  })

  const lanServer = createServer((req, res) => {
    void app.router.handle(req, res, false)
  })
  lanServer.on('upgrade', (req, socket, head) => app.upgrade(req, socket, head, false))
  const adminServer = createAdminServer({ router: app.router, upgrade: app.upgrade, logger })
  const lanPort = await listen(lanServer)
  const adminPort = await listen(adminServer)

  const call: TestBridge['call'] = async (listener, path, callOptions = {}) => {
    const port = listener === 'lan' ? lanPort : adminPort
    const headers: Record<string, string> = { ...(callOptions.headers ?? {}) }
    let body: string | undefined
    if (callOptions.body !== undefined) {
      headers['content-type'] = 'application/json'
      body = JSON.stringify(callOptions.body)
    }
    if (callOptions.cookie !== undefined) headers.cookie = callOptions.cookie
    const response = await fetch(`http://127.0.0.1:${String(port)}${path}`, {
      method: callOptions.method ?? 'GET',
      headers,
      body,
      redirect: 'manual',
    })
    const text = await response.text()
    let json: Record<string, unknown>
    try {
      json = JSON.parse(text) as Record<string, unknown>
    } catch {
      json = {}
    }
    const setCookie = response.headers.getSetCookie?.() ?? []
    return {
      status: response.status,
      headers: response.headers,
      text,
      json,
      cookie: setCookie[0] ?? response.headers.get('set-cookie'),
    }
  }

  const bridge: TestBridge = {
    settings,
    activation: app.activation,
    devices: app.devices,
    supervisor,
    clock,
    upstream,
    tls,
    lanPort,
    adminPort,
    ticket: () => app.pairingTicket(),
    pair: (input) => app.pair(input),
    call,
    wsStatus(url, headers) {
      return new Promise((resolve) => {
        const socket = new WebSocket(url, { headers })
        const timer = setTimeout(() => {
          socket.terminate()
          resolve(-1)
        }, 5_000)
        socket.once('open', () => {
          clearTimeout(timer)
          socket.close()
          resolve(0)
        })
        socket.once('unexpected-response', (_request, response) => {
          clearTimeout(timer)
          response.resume()
          resolve(response.statusCode ?? 0)
        })
        socket.once('error', () => {
          clearTimeout(timer)
          resolve(-2)
        })
      })
    },
    async close() {
      lanServer.closeAllConnections()
      adminServer.closeAllConnections()
      await Promise.all([
        new Promise<void>((resolve) => lanServer.close(() => resolve())),
        new Promise<void>((resolve) => adminServer.close(() => resolve())),
      ])
      await upstream.close()
      await app.dispose()
      await removeTempDir(dir)
    },
  }
  return bridge
}

export function mutationHeaders(port: number): Record<string, string> {
  return { origin: `http://127.0.0.1:${String(port)}`, 'x-hm-csrf': '1' }
}

export function deviceCookie(token = DEVICE_TOKEN): string {
  return `hm_device=${token}`
}

export const TEST_AUTH_COOKIE = TEST_COOKIE
