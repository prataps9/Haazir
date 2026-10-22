import { and, eq } from 'drizzle-orm'
import { contacts, conversations, messages, type AnyDatabase, type MessageType } from '@haazir/db'
import { AppError } from '@haazir/shared'
import {
  bodyOf,
  buildMessagePayload,
  checkOutbound,
  ContentLimitError,
  type OutboundContent,
} from '@haazir/whatsapp'
import type { JobQueue, OutboundJob } from './queue'

export interface QueueOutboundInput {
  orgId: string
  conversationId: string
  content: OutboundContent
  sentBy: 'bot' | 'user' | 'campaign' | 'reminder' | 'system'
  sentByUserId?: string
  /** Quote this inbound message (its wamid) in the reply. */
  replyTo?: string
  /** Our id of the inbound message this answers; lets the bot check it hasn't already. */
  inReplyToMessageId?: string
  isOptOutConfirmation?: boolean
  /**
   * Move the chat to the top of the inbox (default). Campaigns don't: 500
   * broadcasts would bury the chats that need someone. A reply does.
   */
  bumpConversation?: boolean
  now?: Date
}

export type OutboundMessage = typeof messages.$inferSelect

/**
 * The single choke point for everything Haazir sends (spec §10). It:
 *   1. checks the contact hasn't opted out,
 *   2. checks the 24-hour window (free-form only inside it; templates any time),
 *   3. validates the content against WhatsApp's limits,
 *   4. writes the message row (status `queued`) BEFORE anything reaches Meta,
 *   5. hands it to the outbound queue, which does the actual send.
 * Plan limits join these checks in Phase 6; per-number throughput is the
 * outbound worker's rate limiter.
 *
 * Throws AppError OPTED_OUT, WINDOW_CLOSED or VALIDATION; nothing is written then.
 */
export async function queueOutbound(
  deps: { db: AnyDatabase; outboundQueue: JobQueue<OutboundJob> },
  input: QueueOutboundInput,
): Promise<OutboundMessage> {
  const { db } = deps
  const [row] = await db
    .select({ conversation: conversations, contact: contacts })
    .from(conversations)
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
    .where(and(eq(conversations.id, input.conversationId), eq(conversations.orgId, input.orgId)))
  if (!row) throw new AppError('NOT_FOUND', 'Conversation not found')

  const gate = checkOutbound({
    kind: input.content.kind === 'template' ? 'template' : 'freeform',
    optInStatus: row.contact.optInStatus,
    windowExpiresAt: row.conversation.serviceWindowExpiresAt,
    now: input.now,
    isOptOutConfirmation: input.isOptOutConfirmation,
  })
  if (!gate.ok) throw new AppError(gate.code, gate.reason)

  try {
    buildMessagePayload(row.contact.waId, input.content, input.replyTo)
  } catch (err) {
    if (err instanceof ContentLimitError) throw new AppError('VALIDATION', err.message)
    throw err
  }

  const now = input.now ?? new Date()
  const body = bodyOf(input.content)
  const [message] = await db
    .insert(messages)
    .values({
      orgId: input.orgId,
      conversationId: row.conversation.id,
      direction: 'out',
      type: typeFor(input.content),
      body,
      // The full content, so the outbound worker can build the exact request
      // and the inbox can render buttons and lists as sent.
      interactive: {
        content: input.content,
        ...(input.replyTo ? { replyTo: input.replyTo } : {}),
        ...(input.inReplyToMessageId ? { inReplyToMessageId: input.inReplyToMessageId } : {}),
      },
      status: 'queued',
      sentBy: input.sentBy,
      sentByUserId: input.sentByUserId,
      replyToWaMessageId: input.replyTo,
    })
    .returning()
  if (!message) throw new Error('insert returned no row')

  if (input.bumpConversation !== false)
    await db
      .update(conversations)
      .set({ lastMessageAt: now, lastMessagePreview: body?.slice(0, 120) ?? null })
      .where(eq(conversations.id, row.conversation.id))

  // jobId = message id: enqueueing the same message twice sends it once.
  await deps.outboundQueue.add('send', { messageId: message.id }, { jobId: message.id })
  return message
}

function typeFor(content: OutboundContent): MessageType {
  switch (content.kind) {
    case 'buttons':
    case 'list':
      return 'interactive'
    default:
      return content.kind
  }
}
