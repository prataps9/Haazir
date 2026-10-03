import request from 'supertest'
import { contacts, conversations, messages, whatsappAccounts, type AnyDatabase } from '@haazir/db'
import { seed } from '@haazir/db/seed'
import { DEMO_PASSWORD, DEMO_USERS, SECOND_ORG_OWNER } from '@haazir/db/seed-data'
import { createTestDb } from '@haazir/db/testing'
import type { IngestJob, OrgEventName, OutboundJob } from '@haazir/messaging'
import { LocalStorage } from '@haazir/storage'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp, type AppDeps } from '../app'
import { createAuth } from '../auth/auth'
import { createLogger } from '../logger'

export const ORIGIN = 'http://localhost:5173'
export const ENCRYPTION_KEY = Buffer.alloc(32, 3).toString('base64')
const logger = createLogger({ name: 'test', level: 'silent', pretty: false })

/** Queues and live events, recorded instead of sent through Redis. */
export function recorders() {
  return {
    outbound: [] as OutboundJob[],
    ingest: [] as IngestJob[],
    events: [] as { orgId: string; event: OrgEventName; data: unknown }[],
  }
}

/**
 * The full API on a fresh PGlite: two seeded institutes, each with a
 * WhatsApp number and one conversation, real Better Auth with demo logins.
 */
export async function createTestApp(overrides: Partial<AppDeps> = {}) {
  const { db, close } = await createTestDb()
  const seeded = await seed(db, { passwords: true })
  const rec = recorders()
  const now = new Date()

  const fixtureFor = async (orgId: string, phoneNumberId: string, waId: string) => {
    const [account] = await db
      .insert(whatsappAccounts)
      .values({ orgId, wabaId: `w${phoneNumberId}`, phoneNumberId, accessTokenEnc: 'v1.a.b.c' })
      .returning()
    const [contact] = await db
      .insert(contacts)
      .values({ orgId, waId, profileName: `Contact ${waId}` })
      .returning()
    const [conversation] = await db
      .insert(conversations)
      .values({
        orgId,
        contactId: contact!.id,
        whatsappAccountId: account!.id,
        serviceWindowExpiresAt: new Date(now.getTime() + 3_600_000),
        lastMessageAt: now,
        lastMessagePreview: 'Fees kitni hai?',
        unreadCount: 1,
      })
      .returning()
    const [message] = await db
      .insert(messages)
      .values({
        orgId,
        conversationId: conversation!.id,
        direction: 'in',
        type: 'text',
        body: 'Fees kitni hai?',
        waMessageId: `wamid.${waId}`,
      })
      .returning()
    return { account: account!, contact: contact!, conversation: conversation!, message: message! }
  }

  const a = await fixtureFor(seeded.org.id, '111', '919811111111')
  const b = await fixtureFor(seeded.second.id, '222', '919822222222')

  const auth = createAuth({
    db,
    secret: 'test-secret-test-secret-test-secret-123',
    baseURL: 'http://localhost:4000',
    appOrigins: [ORIGIN],
    rateLimit: false,
  })
  const storageDir = await mkdtemp(join(tmpdir(), 'haazir-api-'))
  const deps: AppDeps = {
    logger,
    corsOrigins: [ORIGIN],
    appUrl: ORIGIN,
    database: { ping: async () => {} },
    redis: { ping: async () => 'PONG', get: async () => null },
    whatsapp: { inboundQueue: { add: async () => undefined } },
    db: db as AnyDatabase,
    auth,
    queues: {
      outbound: { add: async (_n, data) => void rec.outbound.push(data) },
      ingest: { add: async (_n, data) => void rec.ingest.push(data) },
    },
    storage: new LocalStorage(storageDir),
    models: null,
    events: { emit: (orgId, event, data) => void rec.events.push({ orgId, event, data }) },
    graph: () => {
      throw new Error('graph not mocked')
    },
    encryptionKey: ENCRYPTION_KEY,
    vapidPublicKey: 'BTestPublicKey',
    now: () => new Date(),
    ...overrides,
  }
  const app = createApp(deps)

  /** A supertest agent logged in as this person (cookies kept between requests). */
  async function login(email: string, password = DEMO_PASSWORD) {
    const agent = request.agent(app)
    const res = await agent
      .post('/api/v1/auth/sign-in/email')
      .set('origin', ORIGIN)
      .send({ email, password })
    if (res.status !== 200)
      throw new Error(`login ${email} failed: ${res.status} ${JSON.stringify(res.body)}`)
    return agent
  }

  return {
    app,
    deps,
    db: db as AnyDatabase,
    rec,
    seeded,
    orgA: { ...a, org: seeded.org },
    orgB: { ...b, org: seeded.second },
    login,
    users: {
      owner: DEMO_USERS.owner.email,
      staff: DEMO_USERS.staff.email,
      superAdmin: DEMO_USERS.superAdmin.email,
      secondOwner: SECOND_ORG_OWNER.email,
    },
    close,
  }
}
