/**
 * Queue names (spec §7), shared so the API enqueues onto exactly the queue the
 * worker listens to. `system` carries housekeeping such as the heartbeat.
 */
export const QUEUES = {
  system: 'system',
  inbound: 'inbound',
  aiReply: 'ai-reply',
  outbound: 'outbound',
  media: 'media',
  ingest: 'ingest',
  campaign: 'campaign',
  reminder: 'reminder',
  summary: 'summary',
  templateSync: 'template-sync',
} as const

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES]

/** Redis key the worker refreshes every minute; the API's /ready reads it. */
export const WORKER_HEARTBEAT_KEY = 'haazir:worker:heartbeat'

/**
 * Retry policy per queue (spec §7), applied by whoever adds the job. Plain
 * objects so this file stays free of BullMQ; they match BullMQ's JobsOptions.
 * Completed jobs are kept briefly for debugging, failed ones longer.
 */
const keep = { removeOnComplete: { count: 1000 }, removeOnFail: { count: 5000 } }
export const JOB_OPTIONS = {
  inbound: { attempts: 5, backoff: { type: 'exponential', delay: 1000 }, ...keep },
  aiReply: { attempts: 2, backoff: { type: 'exponential', delay: 2000 }, ...keep },
  outbound: { attempts: 5, backoff: { type: 'exponential', delay: 1000 }, ...keep },
  media: { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, ...keep },
  ingest: { attempts: 3, backoff: { type: 'exponential', delay: 10000 }, ...keep },
  reminder: { attempts: 3, backoff: { type: 'exponential', delay: 30000 }, ...keep },
  campaign: { attempts: 5, backoff: { type: 'exponential', delay: 5000 }, ...keep },
  summary: { attempts: 3, backoff: { type: 'exponential', delay: 60000 }, ...keep },
  templateSync: { attempts: 1, ...keep },
} as const
