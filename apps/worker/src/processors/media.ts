import { eq } from 'drizzle-orm'
import { conversations, messages, whatsappAccounts } from '@haazir/db'
import { announceMessage, type MediaJob } from '@haazir/messaging'
import { buffer } from 'node:stream/consumers'
import { extensionFor } from '@haazir/storage'
import type { Deps } from '../deps'

/** WhatsApp's own ceiling is 100 MB (documents); anything claiming more is refused. */
const MAX_BYTES = 100 * 1024 * 1024

/**
 * The `media` queue: copies an inbound photo, voice note or document from
 * Meta into our storage. Meta's copy is only kept for a limited time and its
 * download URL expires within minutes, so this runs as soon as it arrives.
 *
 * Voice notes are then transcribed and handed to the brain, which answers
 * the transcript like typed text (spec §11.1).
 */
export async function processMedia(deps: Deps, job: MediaJob, isLastAttempt = false) {
  try {
    return await storeMedia(deps, job)
  } catch (err) {
    // Out of retries: a voice note still deserves an answer (the brain hands
    // it to staff when there's no transcript), rather than silence.
    if (isLastAttempt) await queueReplyIfAudio(deps, job)
    throw err
  }
}

async function queueReplyIfAudio(deps: Deps, job: MediaJob) {
  const [row] = await deps.db
    .select({ type: messages.type, conversationId: messages.conversationId })
    .from(messages)
    .where(eq(messages.id, job.messageId))
  if (row?.type !== 'audio') return
  await deps.queues.aiReply.add(
    'reply',
    { orgId: job.orgId, conversationId: row.conversationId, messageId: job.messageId },
    { jobId: `reply-${job.messageId}` },
  )
}

async function storeMedia(deps: Deps, job: MediaJob) {
  const [row] = await deps.db
    .select({ message: messages, account: whatsappAccounts })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .innerJoin(whatsappAccounts, eq(whatsappAccounts.id, conversations.whatsappAccountId))
    .where(eq(messages.id, job.messageId))
  if (!row || row.message.orgId !== job.orgId) {
    deps.log.warn({ job }, 'media for a missing message skipped')
    return { stored: false }
  }
  if (row.message.mediaKey) {
    // Stored by an earlier attempt; make sure a voice note still gets its reply.
    if (row.message.type === 'audio')
      await transcribeAndReply(deps, job, row.message.mediaKey, row.message.mediaMime)
    return { stored: false }
  }

  const graph = deps.graph(row.account)
  const info = await graph.getMedia(job.mediaId)
  if (info.fileSize !== undefined && info.fileSize > MAX_BYTES) {
    deps.log.warn({ messageId: row.message.id, size: info.fileSize }, 'media too large, not stored')
    return { stored: false }
  }

  const mime = info.mimeType ?? job.mimeType ?? 'application/octet-stream'
  const key = `orgs/${job.orgId}/media/${row.message.id}.${extensionFor(mime)}`
  const res = await graph.downloadMedia(info.url)
  const { size } = await deps.storage.put(key, res.body!, mime)

  await deps.db
    .update(messages)
    .set({ mediaKey: key, mediaMime: mime })
    .where(eq(messages.id, row.message.id))
  await announceMessage(deps.db, deps.events, job.orgId, row.message.id)

  if (row.message.type === 'audio') await transcribeAndReply(deps, job, key, mime)
  return { stored: true, key, size }
}

async function transcribeAndReply(deps: Deps, job: MediaJob, key: string, mime: string | null) {
  const [current] = await deps.db
    .select({ transcript: messages.transcript, conversationId: messages.conversationId })
    .from(messages)
    .where(eq(messages.id, job.messageId))
  if (!current) return

  if (deps.stt && !current.transcript) {
    try {
      const { body } = await deps.storage.get(key)
      const audio = new Uint8Array(await buffer(body))
      const { text } = await deps.stt.transcribe(audio, mime ?? 'audio/ogg')
      if (text) {
        await deps.db
          .update(messages)
          .set({ transcript: text })
          .where(eq(messages.id, job.messageId))
      }
    } catch (err) {
      // No transcript: the brain will hand this voice note to staff.
      deps.log.warn(
        { messageId: job.messageId, err: (err as Error).message },
        'transcription failed',
      )
    }
  }

  await deps.queues.aiReply.add(
    'reply',
    { orgId: job.orgId, conversationId: current.conversationId, messageId: job.messageId },
    { jobId: `reply-${job.messageId}` },
  )
}
