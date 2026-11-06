import { z } from 'zod'

export const SCHEMA_VERSION = 2
export const DEFAULT_PORT = 8443
export const DEFAULT_PROFILE = 'mobile'

const LanSchema = z
  .object({
    /** `auto` resuelve la primera IPv4 privada de una interfaz física. */
    host: z.string().min(1).default('auto'),
    port: z.number().int().min(1).max(65_535).default(DEFAULT_PORT),
  })
  .strict()
  .default({})

const AdminSchema = z
  .object({
    /** Solo loopback literal: el panel nunca puede escucharse en la LAN. */
    host: z
      .string()
      .min(1)
      .default('127.0.0.1')
      .refine((value) => value === '127.0.0.1' || value === '::1', {
        message: 'server.admin.host debe ser loopback literal ("127.0.0.1" o "::1").',
      }),
    /** `null` = `server.lan.port + 1`. */
    port: z.number().int().min(1).max(65_535).nullable().default(null),
  })
  .strict()
  .default({})

const ServerSchema = z
  .object({
    lan: LanSchema,
    admin: AdminSchema,
    /** Nombre DNS opcional anunciado en el certificado y las URLs. */
    publicHost: z.string().min(1).nullable().default(null),
  })
  .strict()
  .default({})

const HarnessSchema = z
  .object({
    /** `auto` prueba PATH y luego el CLI de la app de escritorio. */
    command: z.string().min(1).default('auto'),
    profile: z.string().min(1).default(DEFAULT_PROFILE),
    /** `null` = `$DSH_HOME` o `~/.dsh`. */
    home: z.string().min(1).nullable().default(null),
    sessions: z.enum(['isolated', 'shared']).default('isolated'),
    extraArgs: z.array(z.string()).default([]),
    startTimeoutMs: z.number().int().min(5_000).max(300_000).default(90_000),
  })
  .strict()
  .default({})

const TlsSchema = z
  .object({
    mode: z.enum(['local-ca', 'files']).default('local-ca'),
    certFile: z.string().min(1).nullable().default(null),
    keyFile: z.string().min(1).nullable().default(null),
    caFile: z.string().min(1).nullable().default(null),
  })
  .strict()
  .default({})

const PairingSchema = z
  .object({
    ticketTtlSeconds: z.number().int().min(30).max(3_600).default(300),
    maxDevices: z.number().int().min(1).max(20).default(3),
  })
  .strict()
  .default({})

const ActivationSchema = z
  .object({
    autoStart: z.boolean().default(false),
    /** 0 desactiva el apagado por inactividad. */
    idleAutoOffMinutes: z.number().int().min(0).max(720).default(30),
  })
  .strict()
  .default({})

const LimitsSchema = z
  .object({
    pairingPerMinute: z.number().int().min(1).max(120).default(10),
    /** Solo cuerpos JSON del panel; el tráfico proxeado fluye sin buffer. */
    maxBodyBytes: z.number().int().min(1_024).max(16_777_216).default(1_048_576),
  })
  .strict()
  .default({})

export const ConfigSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    server: ServerSchema,
    harness: HarnessSchema,
    tls: TlsSchema,
    pairing: PairingSchema,
    activation: ActivationSchema,
    limits: LimitsSchema,
  })
  .strict()

export type AppConfig = z.infer<typeof ConfigSchema>

export function defaultConfig(): AppConfig {
  return ConfigSchema.parse({ schemaVersion: SCHEMA_VERSION })
}

export function formatIssues(issues: readonly { path: PropertyKey[]; message: string }[]): string {
  return issues.map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`).join('; ')
}
