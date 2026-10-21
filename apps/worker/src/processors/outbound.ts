import type { Readable } from 'node:stream'
import { eq } from 'drizzle-orm'
import { contacts, conversations, messages, whatsappAccounts } from '@haazir/db'
import { announceMessage, markAccountError, type OutboundJob } from '@haazir/messaging'
import { ContentLimitError, GraphError, type OutboundContent } from '@haazir/whatsapp'
import type { Deps } from '../deps'

/** Thrown for failures worth retrying; BullMQ backs off and tries again. */
export class RetryableSendError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RetryableSendError'
  }
}

/**
 * The `outbound` queue: the only code that calls Meta's send API. The row was
 * written by queueOutbound; this sends it and records Meta's message id, which
 * is what later delivery statuses are matched on.
 *
 * Retries 5xx, throttling and network errors (by throwing); records policy
 * errors (window closed, blocked, bad input) as `failed` and stops, because
 * sending the same request again would fail the same way.
 */
export async function processOutbound(deps: Deps, job: OutboundJob, isLastAttempt = false) {
  const [row] = await deps.db
    .select({ message: messages, contact: contacts, account: whatsappAccounts })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
    .innerJoin(whatsappAccounts, eq(whatsappAccounts.id, conversations.whatsappAccountId))
    .where(eq(messages.id, job.messageId))
  if (!row) {
    deps.log.warn({ job }, 'outbound for a missing message skipped')
    return { sent: false }
  }
  // Already sent (a retried job after a crash between send and ack): don't double-send.
  if (row.message.waMessageId || row.message.status !== 'queued') return { sent: false }

  const stored = row.message.interactive as { content?: OutboundContent; replyTo?: string } | null
  if (!stored?.content) {
    await fail(deps, row.message.id, 'NO_CONTENT', 'Message has no content to send')
    return { sent: false }
  }

  const graph = deps.graph(row.account)
  try {
    let content = stored.content
    if (
      (content.kind === 'document' || content.kind === 'image') &&
      content.storageKey &&
      !content.mediaId &&
      !content.link
    ) {
      // Our own file (a brochure): upload it to Meta once, keep the id for retries.
      const file = await deps.storage.get(content.storageKey).catch(() => null)
      if (!file) {
        await fail(deps, row.message.id, 'NO_FILE', 'The file to send is missing from storage')
        return { sent: false }
      }
      const mimeType =
        content.kind === 'document' ? (content.mimeType ?? file.contentType) : file.contentType
      const mediaId = await graph.uploadMedia(
        await toBuffer(file.body),
        mimeType ?? 'application/pdf',
        (content.kind === 'document' && content.filename) || 'file.pdf',
      )
      content = { ...content, mediaId }
      await deps.db
        .update(messages)
        .set({ interactive: { ...stored, content } })
        .where(eq(messages.id, row.message.id))
    }
    const waMessageId = await graph.send(row.contact.waId, content, stored.replyTo)
    await deps.db.update(messages).set({ waMessageId }).where(eq(messages.id, row.message.id))
    await announceMessage(deps.db, deps.events, row.message.orgId, row.message.id)
    return { sent: true, waMessageId }
  } catch (err) {
    if (err instanceof ContentLimitError) {
      await fail(deps, row.message.id, 'CONTENT_LIMIT', err.message)
      return { sent: false }
    }
    if (err instanceof GraphError) {
      if (err.retryable && !isLastAttempt) throw new RetryableSendError(err.message)
      if (err.isAuthError) await markAccountError(deps.db, row.account.id, err.message)
      await fail(deps, row.message.id, String(err.code ?? err.status), err.details ?? err.message)
      deps.log.warn(
        { messageId: row.message.id, code: err.code, error: err.message },
        'send failed',
      )
      return { sent: false }
    }
    throw err
  }
}

async function toBuffer(body: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of body) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks)
}

async function fail(deps: Deps, messageId: string, code: string, title: string) {
  const [row] = await deps.db
    .update(messages)
    .set({ status: 'failed', errorCode: code, errorTitle: title })
    .where(eq(messages.id, messageId))
    .returning({ orgId: messages.orgId })
  if (row) await announceMessage(deps.db, deps.events, row.orgId, messageId)
}
