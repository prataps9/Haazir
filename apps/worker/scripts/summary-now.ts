/**
 * The owner's 8 PM summary, now: queues today's summary for the demo
 * institute (WHATSAPP_ORG_SLUG). The running worker sends it to every owner
 * and admin who turned it on in Settings. Each run counts as a new day's job.
 *
 *   pnpm summary:now
 */
import { Queue } from 'bullmq'
import { Redis } from 'ioredis'
import { eq } from 'drizzle-orm'
import { createDb, organizations } from '@haazir/db'
import type { SummaryJob } from '@haazir/messaging'
import { QUEUES } from '@haazir/shared'
import { loadEnv } from '@haazir/shared/env'

const env = loadEnv()
const { db, close } = createDb(env.DATABASE_URL, { max: 1 })
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null })
try {
  const [org] = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(eq(organizations.slug, env.WHATSAPP_ORG_SLUG))
  if (!org) throw new Error('Run pnpm db:seed first.')
  const queue = new Queue<SummaryJob>(QUEUES.summary, { connection })
  const day = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10)
  await queue.add(
    'summary',
    { orgId: org.id, day },
    { jobId: `summary-${org.id}-now-${Date.now()}` },
  )
  await queue.close()
  console.log(`Queued today's summary for ${org.name}. The worker sends it in a moment.`)
} finally {
  await connection.quit()
  await close()
}
