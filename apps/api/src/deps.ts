import type { Models } from '@haazir/ai-core'
import type { RazorpayFactory } from '@haazir/coaching'
import type { AnyDatabase } from '@haazir/db'
import type {
  CampaignJob,
  IngestJob,
  JobQueue,
  OrgEvents,
  OutboundJob,
  ReminderJob,
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
  /** This API's public URL, for webhooks other services call (Razorpay). */
  apiUrl: string
  whatsapp: WhatsappWebhookDeps
  db: AnyDatabase
  auth: Auth
  queues: {
    outbound: JobQueue<OutboundJob>
    ingest: JobQueue<IngestJob>
    /** Demo reminders and follow-ups, scheduled when staff book a demo. */
    reminder: JobQueue<ReminderJob>
    /** Campaign sends (spec §16.8), started when one is scheduled. */
    campaign: JobQueue<CampaignJob>
  }
  storage: Storage
  /** Null when no LLM is configured (the playground then says so). */
  models: Models | null
  events: OrgEvents
  graph(account: WhatsappAccount): GraphClient
  encryptionKey?: string
  /** Razorpay client for an institute's own keys (a fake in tests). */
  razorpay?: RazorpayFactory
  vapidPublicKey?: string
  now(): Date
}
