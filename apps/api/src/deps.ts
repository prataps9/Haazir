import type { Models } from '@haazir/ai-core'
import type { AnyDatabase } from '@haazir/db'
import type {
  IngestJob,
  JobQueue,
  OrgEvents,
  OutboundJob,
  WhatsappAccount,
} from '@haazir/messaging'
import type { Storage } from '@haazir/storage'
import type { GraphClient } from '@haazir/whatsapp'
import type { Auth } from './auth/auth'
import type { Logger } from './logger'
import type { HealthDeps } from './routes/health'
import type { WhatsappWebhookDeps } from './webhooks/whatsapp'

/**
 * Everything the API needs, passed in: the same app runs on Postgres + Redis
 * in production and on PGlite with recorders in tests.
 */
export interface AppDeps extends HealthDeps {
  logger: Logger
  /** Origins allowed to call the API from a browser (the dashboard). */
  corsOrigins: string[]
  /** Where invite links point (the dashboard's URL). */
  appUrl: string
  whatsapp: WhatsappWebhookDeps
  db: AnyDatabase
  auth: Auth
  queues: { outbound: JobQueue<OutboundJob>; ingest: JobQueue<IngestJob> }
  storage: Storage
  /** Null when no LLM is configured (the playground then says so). */
  models: Models | null
  events: OrgEvents
  graph(account: WhatsappAccount): GraphClient
  encryptionKey?: string
  vapidPublicKey?: string
  now(): Date
}
