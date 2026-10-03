import { and, eq, sql } from 'drizzle-orm'
import { contacts, conversations, messages, whatsappAccounts } from '@haazir/db'
import { announceMessage, type WhatsappAccount } from '@haazir/messaging'
import {
  extendWindow,
  parseWebhook,
  previewOf,
  type InboundMessage,
  type StatusUpdate,
} from '@haazir/whatsapp'
import type { Deps } from '../deps'

/** Types that deserve a reply. A reaction or an unreadable message doesn't. */
const REPLYABLE = new Set([
  'text',
  'audio',
  'image',
  'document',
  'video',
  'interactive',
  'button',
  'location',
])
const MEDIA = new Set(['image', 'audio', 'video', 'document', 'sticker'])
const DEDUPE_TTL_SECONDS = 24 * 60 * 60

/** A status for a message we haven't recorded the wamid of yet (the send is still in flight). */
export class StatusNotYetMatched extends Error {
  constructor(readonly waMessageIds: string[]) {
    super(`No message yet for ${waMessageIds.length} status update(s); will retry`)
    this.name = 'StatusNotYetMatched'
  }
}

/**
 * The `inbound` queue: one webhook delivery per job (spec §7). Stores messages
 * and statuses idempotently, keeps the contact and conversation up to date,
 * and hands off to `media` and `ai-reply`.
 *
 * Meta retries deliveries it isn't sure we got, and sometimes sends the same
 * one twice anyway, so every step is safe to repeat: the unique wa_message_id
 * is the guarantee, and a Redis key (24h), set once a message is fully
 * handled, is the fast path that skips work.
 */
export async function processInbound(
  deps: Deps,
  job: { payload: unknown },
  attemptsMade = 0,
): Promise<{ stored: number; duplicates: number; statuses: number; dropped: number }> {
  const parsed = parseWebhook(job.payload)
  for (const problem of parsed.problems) deps.log.warn({ problem }, 'webhook problem')

  const accounts = new Map<string, WhatsappAccount | null>()
  const accountFor = async (phoneNumberId: string) => {
    if (!accounts.has(phoneNumberId)) {
      const [account] = await deps.db
        .select()
        .from(whatsappAccounts)
        .where(eq(whatsappAccounts.phoneNumberId, phoneNumberId))
      accounts.set(phoneNumberId, account ?? null)
    }
    return accounts.get(phoneNumberId) ?? null
  }

  const counts = { stored: 0, duplicates: 0, statuses: 0, dropped: 0 }

  for (const message of parsed.messages) {
    if (await deps.kv.exists(`haazir:msg:${message.waMessageId}`)) {
      counts.duplicates++
      continue
    }
    const account = await accountFor(message.phoneNumberId)
    if (!account) {
      // A number we don't know: someone else's webhook, or a disconnected org.
      deps.log.warn({ phoneNumberId: message.phoneNumberId }, 'message for unknown number dropped')
      counts.dropped++
      continue
    }

    const stored = await deps.locks.withLock(
      `contact-${account.id}-${message.bsuid ?? message.from}`,
      () => storeInbound(deps, account, message),
    )
    if (stored.isNew) {
      counts.stored++
      await announceMessage(deps.db, deps.events, account.orgId, stored.messageId, 'message:new')
    } else {
      counts.duplicates++
    }

    // Hand off even for a duplicate: if an earlier attempt stored the message
    // but crashed before queueing, this is what gets the reply out. Both
    // downstream jobs are idempotent (job id + checks in the processors).
    if (MEDIA.has(message.type) && message.media) {
      await deps.queues.media.add(
        'download',
        {
          orgId: account.orgId,
          messageId: stored.messageId,
          mediaId: message.media.id,
          mimeType: message.media.mimeType,
        },
        { jobId: `media-${stored.messageId}` },
      )
    }
    // Voice notes are answered after the media job has transcribed them.
    if (stored.mode === 'bot' && REPLYABLE.has(message.type) && message.type !== 'audio') {
      await deps.queues.aiReply.add(
        'reply',
        {
          orgId: account.orgId,
          conversationId: stored.conversationId,
          messageId: stored.messageId,
        },
        { jobId: `reply-${stored.messageId}` },
      )
    }
    // Only now is the message fully handled; the fast path may skip it next time.
    await deps.kv.set(`haazir:msg:${message.waMessageId}`, '1', DEDUPE_TTL_SECONDS)
  }

  const unmatched: string[] = []
  for (const status of parsed.statuses) {
    const account = await accountFor(status.phoneNumberId)
    if (!account) {
      counts.dropped++
      continue
    }
    const messageId = await applyStatus(deps, account, status)
    if (messageId) {
      counts.statuses++
      await announceMessage(deps.db, deps.events, account.orgId, messageId)
    } else {
      unmatched.push(status.waMessageId)
    }
  }

  if (unmatched.length) {
    // Usually the send is mid-flight and our row doesn't have the wamid yet.
    // Retry a few times; after that it's a message sent outside Haazir (from
    // the phone app, say) and there's nothing to update.
    if (attemptsMade < 3) throw new StatusNotYetMatched(unmatched)
    deps.log.info({ waMessageIds: unmatched }, 'statuses for unknown messages ignored')
  }

  return counts
}

async function storeInbound(deps: Deps, account: WhatsappAccount, m: InboundMessage) {
  const { db } = deps
  return db.transaction(async (tx) => {
    const contact = await upsertContact(tx as unknown as Deps['db'], account.orgId, m)

    const [conversation] = await tx
      .insert(conversations)
      .values({
        orgId: account.orgId,
        contactId: contact.id,
        whatsappAccountId: account.id,
      })
      .onConflictDoUpdate({
        target: [conversations.orgId, conversations.contactId],
        set: { whatsappAccountId: account.id },
      })
      .returning()
    if (!conversation) throw new Error('conversation upsert returned no row')

    const [message] = await tx
      .insert(messages)
      .values({
        orgId: account.orgId,
        conversationId: conversation.id,
        direction: 'in',
        waMessageId: m.waMessageId,
        type: m.type,
        body: m.text ?? null,
        interactive: m.interactive ?? m.location ?? m.reaction ?? null,
        mediaId: m.media?.id,
        mediaMime: m.media?.mimeType,
        replyToWaMessageId: m.replyTo,
        waTimestamp: m.timestamp,
      })
      .onConflictDoNothing({ target: messages.waMessageId })
      .returning({ id: messages.id })
    if (!message) {
      // Stored by an earlier delivery (or an earlier attempt of this job).
      const [existing] = await tx
        .select({ id: messages.id })
        .from(messages)
        .where(eq(messages.waMessageId, m.waMessageId))
      return {
        messageId: existing!.id,
        conversationId: conversation.id,
        mode: conversation.mode,
        isNew: false,
      }
    }

    const window = extendWindow(conversation.serviceWindowExpiresAt, m.timestamp)
    const latest = !conversation.lastMessageAt || m.timestamp >= conversation.lastMessageAt
    await tx
      .update(conversations)
      .set({
        serviceWindowExpiresAt: window,
        unreadCount: sql`${conversations.unreadCount} + 1`,
        // A delivery that arrives late mustn't overwrite a newer preview.
        ...(latest ? { lastMessageAt: m.timestamp, lastMessagePreview: previewOf(m) } : {}),
      })
      .where(eq(conversations.id, conversation.id))

    return {
      messageId: message.id,
      conversationId: conversation.id,
      mode: conversation.mode,
      isNew: true,
    }
  })
}

/**
 * Finds the contact by BSUID first (stable even if they switch to a username),
 * then by wa_id. Keeps the phone number as wa_id when we have one.
 */
async function upsertContact(db: Deps['db'], orgId: string, m: InboundMessage) {
  const isPhone = /^\d{8,15}$/.test(m.from)
  const [existing] = m.bsuid
    ? await db
        .select()
        .from(contacts)
        .where(and(eq(contacts.orgId, orgId), eq(contacts.bsuid, m.bsuid)))
    : []
  const byWaId =
    existing ??
    (
      await db
        .select()
        .from(contacts)
        .where(and(eq(contacts.orgId, orgId), eq(contacts.waId, m.from)))
    )[0]

  if (byWaId) {
    const [updated] = await db
      .update(contacts)
      .set({
        profileName: m.profileName ?? byWaId.profileName,
        bsuid: byWaId.bsuid ?? m.bsuid,
        // Learn the phone number if we only had a BSUID; never swap a phone for a BSUID.
        ...(isPhone && byWaId.waId !== m.from ? { waId: m.from } : {}),
        lastInboundAt:
          byWaId.lastInboundAt && byWaId.lastInboundAt > m.timestamp
            ? byWaId.lastInboundAt
            : m.timestamp,
      })
      .where(eq(contacts.id, byWaId.id))
      .returning()
    return updated!
  }

  const [created] = await db
    .insert(contacts)
    .values({
      orgId,
      waId: m.from,
      bsuid: m.bsuid,
      profileName: m.profileName,
      lastInboundAt: m.timestamp,
    })
    .returning()
  return created!
}

// Statuses can arrive out of order (read before delivered); only move forward.
const RANK = { queued: 0, sent: 1, delivered: 2, read: 3 } as const

async function applyStatus(
  deps: Deps,
  account: WhatsappAccount,
  s: StatusUpdate,
): Promise<string | null> {
  // Scoped to the number the status came from: one org's webhook can never
  // touch another org's messages, whatever ids it carries.
  const [row] = await deps.db
    .select({ id: messages.id, status: messages.status })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(
      and(
        eq(messages.waMessageId, s.waMessageId),
        eq(conversations.whatsappAccountId, account.id),
        eq(messages.orgId, account.orgId),
      ),
    )
  if (!row) return null

  const current = row.status ?? 'queued'
  const forward =
    s.status === 'failed'
      ? current !== 'read' && current !== 'failed' // a read message can't have failed
      : current !== 'failed' && RANK[s.status] > RANK[current]

  const error = s.errors[0]
  await deps.db
    .update(messages)
    .set({
      ...(forward ? { status: s.status } : {}),
      ...(s.pricingCategory ? { pricingCategory: s.pricingCategory } : {}),
      ...(forward && error
        ? { errorCode: String(error.code), errorTitle: error.details ?? error.title }
        : {}),
    })
    .where(eq(messages.id, row.id))
  return row.id
}
