import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { z } from 'zod'

/**
 * Every environment variable the server side reads, validated once at startup.
 *
 * Rule from the spec: never read `process.env` anywhere else. Import `env` from
 * the app's own `env.ts` (which calls `loadEnv`) so a missing value fails at
 * boot with a clear message, not at 11 PM when the first webhook arrives.
 *
 * Integration keys are optional until the phase that needs them; a phase that
 * starts using one tightens it here.
 */

// `.env` files write unset values as `KEY=`. Treat those as missing, not "".
const optional = () =>
  z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined))

const url = () => z.url({ message: 'must be a full URL, e.g. http://localhost:4000' })

const base64Key = z
  .string()
  .trim()
  .refine((v) => Buffer.from(v, 'base64').length === 32, {
    message: 'must be 32 bytes, base64 encoded. Generate one: openssl rand -base64 32',
  })

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    APP_URL: url(),
    API_URL: url(),
    DATABASE_URL: url(),
    REDIS_URL: url(),

    ENCRYPTION_KEY: optional().pipe(base64Key.optional()),
    BETTER_AUTH_SECRET: optional(),

    META_APP_ID: optional(),
    META_APP_SECRET: optional(),
    META_WEBHOOK_VERIFY_TOKEN: optional(),
    // Pinned after checking Meta's changelog: v26.0 (released 2026-07-29).
    // Bump deliberately, after reading that version's WhatsApp changes.
    META_GRAPH_API_VERSION: z
      .string()
      .regex(/^v\d+\.\d$/, { message: 'must look like v26.0' })
      .default('v26.0'),
    // Only overridden to point at a local mock of the Graph API (tests, dev).
    META_GRAPH_BASE_URL: url().default('https://graph.facebook.com'),

    // Phase 1 is single-tenant: one number, configured here and written to
    // whatsapp_accounts by `pnpm whatsapp:connect`. Phase 3 replaces this with
    // the super-admin connect screen.
    WHATSAPP_PHONE_NUMBER_ID: optional(),
    WHATSAPP_WABA_ID: optional(),
    WHATSAPP_ACCESS_TOKEN: optional(),
    WHATSAPP_ORG_SLUG: z.string().default('shiksha-computer-sikar'),

    // The AI brain (Phase 2). Any of the four providers; models are set per
    // deployment so cost can be tuned without a code change (spec §4).
    LLM_PROVIDER: z.enum(['openai', 'anthropic', 'google', 'azure']).default('openai'),
    LLM_FAST_MODEL: optional(), // routing, classification, extraction
    LLM_SMART_MODEL: optional(), // answers
    // Anthropic has no embedding models, so embeddings have their own provider.
    EMBEDDING_PROVIDER: z.enum(['openai', 'google', 'azure']).default('openai'),
    EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
    OPENAI_API_KEY: optional(),
    ANTHROPIC_API_KEY: optional(),
    GOOGLE_API_KEY: optional(),
    AZURE_OPENAI_ENDPOINT: optional(), // https://<resource>.openai.azure.com/openai
    AZURE_OPENAI_API_KEY: optional(),
    STT_PROVIDER: z.enum(['openai', 'sarvam']).default('openai'),
    STT_MODEL: optional(), // default per provider: gpt-4o-mini-transcribe / saarika:v2.5
    SARVAM_API_KEY: optional(),

    // S3-compatible storage (Cloudflare R2, MinIO…). With no endpoint set,
    // files go to STORAGE_LOCAL_DIR instead, which is fine for development.
    STORAGE_ENDPOINT: optional(),
    STORAGE_REGION: z.string().default('auto'),
    STORAGE_BUCKET: optional(),
    STORAGE_ACCESS_KEY: optional(),
    STORAGE_SECRET_KEY: optional(),
    STORAGE_LOCAL_DIR: z.string().default('.data/storage'),

    RAZORPAY_KEY_ID: optional(),
    RAZORPAY_KEY_SECRET: optional(),
    RAZORPAY_WEBHOOK_SECRET: optional(),

    RESEND_API_KEY: optional(),
    VAPID_PUBLIC_KEY: optional(),
    VAPID_PRIVATE_KEY: optional(),
    // Contact for push services, per the Web Push spec: a mailto: or https: URL.
    VAPID_SUBJECT: z.string().default('mailto:hello@haazir.studio'),
    SENTRY_DSN: optional(),

    // Set by pnpm: the directory a command was typed in, so CLI scripts
    // resolve file arguments from there rather than from their package.
    INIT_CWD: optional(),
  })
  .superRefine((env, ctx) => {
    if (env.STORAGE_ENDPOINT) {
      for (const key of ['STORAGE_BUCKET', 'STORAGE_ACCESS_KEY', 'STORAGE_SECRET_KEY'] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: 'is required when STORAGE_ENDPOINT is set',
          })
        }
      }
    }

    // Secrets that protect stored data are mandatory in production, whatever
    // phase we're in: shipping without them is not recoverable later.
    if (env.NODE_ENV !== 'production') return
    for (const key of ['ENCRYPTION_KEY', 'BETTER_AUTH_SECRET'] as const) {
      if (!env[key]) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'is required in production' })
      }
    }
  })

export type Env = z.infer<typeof envSchema>

export class EnvError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid environment:\n${issues.map((i) => `  - ${i}`).join('\n')}\nSee .env.example.`)
    this.name = 'EnvError'
  }
}

/** Parses and validates `source`. Throws `EnvError` listing every problem at once. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source)
  if (result.success) return result.data
  throw new EnvError(
    result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'} ${issue.message}`),
  )
}

/**
 * Loads the repo-root `.env` (if there is one) into `process.env`, then
 * validates. Values already present in the real environment win, so hosting
 * platforms that inject env vars are not overridden by a stray file.
 */
export function loadEnv(): Env {
  const file = findUp('.env')
  if (file) {
    const before = { ...process.env }
    process.loadEnvFile(file)
    Object.assign(process.env, before)
  }
  return parseEnv(process.env)
}

function findUp(name: string, from = process.cwd()): string | undefined {
  let dir = from
  for (;;) {
    const candidate = join(dir, name)
    if (existsSync(candidate)) return candidate
    // Stop at the repo root rather than wandering into the home directory.
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return undefined
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}
