import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import type { AnyDatabase } from '@haazir/db'
import * as schema from '@haazir/db/schema'

export interface AuthConfig {
  db: AnyDatabase
  secret: string
  /** The API's public URL. */
  baseURL: string
  /** The dashboard's origin, allowed to send credentialed requests. */
  appOrigins: string[]
  /** Turn off rate limiting in tests, which log in dozens of times a second. */
  rateLimit?: boolean
}

/**
 * Better Auth (spec §4): email + password, sessions in Postgres, cookies.
 * Public sign-up is off: accounts come from invites (auth/invites.ts), the
 * seed, or `pnpm admin:create`.
 */
export function createAuth(config: AuthConfig) {
  return betterAuth({
    appName: 'Haazir',
    baseURL: config.baseURL,
    basePath: '/api/v1/auth',
    secret: config.secret,
    database: drizzleAdapter(config.db, {
      provider: 'pg',
      usePlural: true,
      schema: {
        users: schema.users,
        sessions: schema.sessions,
        accounts: schema.accounts,
        verifications: schema.verifications,
      },
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
    },
    user: {
      additionalFields: {
        uiLanguage: { type: 'string', required: false, defaultValue: 'hi', input: false },
        phone: { type: 'string', required: false, input: false },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30, // owners stay logged in on their phone for a month
      updateAge: 60 * 60 * 24,
    },
    trustedOrigins: config.appOrigins,
    rateLimit: { enabled: config.rateLimit ?? true, window: 60, max: 30 },
    advanced: {
      cookiePrefix: 'haazir',
      database: { generateId: 'uuid' },
    },
  })
}

export type Auth = ReturnType<typeof createAuth>
