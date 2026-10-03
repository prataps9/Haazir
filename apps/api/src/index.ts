import { createServer } from 'node:http'
import { Queue } from 'bullmq'
import { Redis } from 'ioredis'
import { AiNotConfiguredError, createModels, type Models } from '@haazir/ai-core'
import { createDb } from '@haazir/db'
import {
  graphClientFor,
  type InboundJob,
  type IngestJob,
  type OutboundJob,
} from '@haazir/messaging'
import { JOB_OPTIONS, QUEUES } from '@haazir/shared'
import { createStorage } from '@haazir/storage'
import { createApp } from './app'
import { createAuth } from './auth/auth'
import { env } from './env'
import { createLogger } from './logger'
import { attachRealtime } from './realtime/socket'

const logger = createLogger({
  name: 'api',
  level: env.LOG_LEVEL,
  pretty: env.NODE_ENV === 'development',
})

const database = createDb(env.DATABASE_URL)
// Fail fast on commands while Redis is down instead of queueing them forever;
// /ready reports it and recovers on its own when Redis is back.
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: false })
redis.on('error', (err) => logger.warn({ err: err.message }, 'redis error'))

// A separate connection for BullMQ, which wants to wait out Redis blips
// rather than fail commands (a webhook we can't queue is retried by Meta).
const queueConnection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null })
queueConnection.on('error', (err) => logger.warn({ err: err.message }, 'redis (queue) error'))
const queue = <T>(name: string, opts: object) =>
  new Queue<T>(name, { connection: queueConnection, defaultJobOptions: opts })
const inboundQueue = queue<InboundJob>(QUEUES.inbound, JOB_OPTIONS.inbound)
const outboundQueue = queue<OutboundJob>(QUEUES.outbound, JOB_OPTIONS.outbound)
const ingestQueue = queue<IngestJob>(QUEUES.ingest, JOB_OPTIONS.ingest)

if (!env.META_APP_SECRET || !env.META_WEBHOOK_VERIFY_TOKEN) {
  logger.warn('META_APP_SECRET / META_WEBHOOK_VERIFY_TOKEN not set: WhatsApp webhooks answer 503')
}

let models: Models | null = null
try {
  models = createModels(env)
} catch (err) {
  if (!(err instanceof AiNotConfiguredError)) throw err
  logger.warn(
    { missing: err.missing },
    'AI not configured: the playground and test box will hand over',
  )
}

const secret =
  env.BETTER_AUTH_SECRET ??
  (env.NODE_ENV === 'production'
    ? undefined
    : 'dev-only-secret-do-not-use-in-production-0123456789')
if (!secret) throw new Error('BETTER_AUTH_SECRET is required')
if (!env.BETTER_AUTH_SECRET)
  logger.warn('BETTER_AUTH_SECRET not set: using a development-only secret')
const auth = createAuth({
  db: database.db,
  secret,
  baseURL: env.API_URL,
  appOrigins: [env.APP_URL],
})

const server = createServer()
const realtime = attachRealtime(server, {
  auth,
  db: database.db,
  corsOrigins: [env.APP_URL],
  redis: { pub: redis.duplicate(), sub: redis.duplicate() },
})

const app = createApp({
  logger,
  database,
  redis,
  corsOrigins: [env.APP_URL],
  appUrl: env.APP_URL,
  whatsapp: {
    appSecret: env.META_APP_SECRET,
    verifyToken: env.META_WEBHOOK_VERIFY_TOKEN,
    inboundQueue,
  },
  db: database.db,
  auth,
  queues: {
    outbound: { add: (name, data, opts) => outboundQueue.add(name, data, opts) },
    ingest: { add: (name, data, opts) => ingestQueue.add(name, data, opts) },
  },
  storage: createStorage(env),
  models,
  events: realtime.events,
  graph: (account) => graphClientFor(account, env),
  encryptionKey: env.ENCRYPTION_KEY,
  vapidPublicKey: env.VAPID_PUBLIC_KEY,
  now: () => new Date(),
})
server.on('request', app)

const port = Number(new URL(env.API_URL).port || 4000)
server.listen(port, () => {
  logger.info(`API listening on http://localhost:${port}`)
})

// Graceful shutdown: stop taking connections, let in-flight requests finish,
// then close pools. Containers get SIGTERM; Ctrl-C sends SIGINT.
let shuttingDown = false
async function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  logger.info({ signal }, 'shutting down')

  const force = setTimeout(() => {
    logger.error('forced exit after 10s')
    process.exit(1)
  }, 10_000)
  force.unref()

  await new Promise<void>((resolve) => realtime.io.close(() => resolve()))
  server.close(async () => {
    await Promise.allSettled([inboundQueue.close(), outboundQueue.close(), ingestQueue.close()])
    await Promise.allSettled([database.close(), redis.quit(), queueConnection.quit()])
    logger.info('bye')
    process.exit(0)
  })
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'unhandled rejection')
})
