import { and, eq, sql } from 'drizzle-orm'
import {
  decideReply,
  markBotReplied,
  markHandoff,
  optOutContact,
  recordTrace,
  recordUnanswered,
} from '@haazir/ai-core'
import { contacts, conversations, messages, whatsappAccounts } from '@haazir/db'
import {
  announceConversation,
  announceMessage,
  notifyOrg,
  queueOutbound,
  type AiReplyJob,
} from '@haazir/messaging'
import { AppError } from '@haazir/shared'
import type { Deps } from '../deps'

/**
 * The `ai-reply` queue: runs the brain (spec §11) on one inbound message and
 * carries out its decision: reply, hand over to staff, confirm an opt-out,
 * or stay quiet. Every reply goes through the outbound gate like any send.
 */
export async function processAiReply(deps: Deps, job: AiReplyJob) {
  const [row] = await deps.db
    .select({ conversation: conversations, message: messages, account: whatsappAccounts })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .innerJoin(whatsappAccounts, eq(whatsappAccounts.id, conversations.whatsappAccountId))
    .where(eq(messages.id, job.messageId))
  if (!row || row.conversation.orgId !== job.orgId) {
    deps.log.warn({ job }, 'ai-reply for a missing message skipped')
    return { replied: false }
  }

  // A retried or re-queued job must not answer the same message twice.
  const [already] = await deps.db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, row.conversation.id),
        eq(messages.direction, 'out'),
        sql`${messages.interactive}->>'inReplyToMessageId' = ${job.messageId}`,
      ),
    )
    .limit(1)
  if (already) return { replied: false }

  const now = deps.now()
  const botHasIt =
    row.conversation.mode === 'bot' ||
    (row.conversation.mode === 'human' &&
      !!row.conversation.humanUntil &&
      row.conversation.humanUntil <= now)

  // Blue ticks + "typing…" while the brain works. Only when the bot is the one
  // answering: ticks with no reply while staff are away would mislead. Best
  // effort: a failed read receipt must not stop the reply.
  if (botHasIt && row.message.waMessageId) {
    await deps
      .graph(row.account)
      .markRead(row.message.waMessageId, { typing: true })
      .catch((err: Error) => deps.log.warn({ err: err.message }, 'markRead failed'))
  }

  const decision = await decideReply(
    { db: deps.db, models: deps.models, now: deps.now, log: deps.log },
    job,
  )
  if (decision.kind === 'silent') return { replied: false, reason: decision.reason }

  const send = async (isOptOutConfirmation = false) => {
    try {
      const message = await queueOutbound(
        { db: deps.db, outboundQueue: deps.queues.outbound },
        {
          orgId: job.orgId,
          conversationId: row.conversation.id,
          content: decision.content,
          sentBy: 'bot',
          inReplyToMessageId: job.messageId,
          isOptOutConfirmation,
          now,
        },
      )
      await announceMessage(deps.db, deps.events, job.orgId, message.id, 'message:new')
      return true
    } catch (err) {
      // Opted out or window closed: correct not to reply, nothing to retry.
      if (err instanceof AppError && (err.code === 'OPTED_OUT' || err.code === 'WINDOW_CLOSED')) {
        deps.log.info({ code: err.code, conversationId: row.conversation.id }, 'reply not sent')
        return false
      }
      throw err
    }
  }

  switch (decision.kind) {
    case 'optout': {
      await optOutContact(deps.db, row.conversation.contactId, now)
      const sent = await send(true)
      await recordTrace(deps.db, job, decision.trace)
      return { replied: sent, decision: 'optout' }
    }
    case 'handoff': {
      const sent = await send()
      await markHandoff(deps.db, row.conversation.id, decision.reason, decision.summary, now)
      if (decision.unanswered) await recordUnanswered(deps.db, job.orgId, decision.unanswered, now)
      await recordTrace(deps.db, job, decision.trace, { reason: decision.reason })
      await announceHandoff(deps, job, decision.reason, decision.summary)
      deps.log.info({ conversationId: row.conversation.id, reason: decision.reason }, 'handed over')
      return { replied: sent, decision: 'handoff', reason: decision.reason }
    }
    case 'reply': {
      const sent = await send()
      await markBotReplied(deps.db, row.conversation.id, now, decision.clarifyMisses ?? 0)
      await announceConversation(deps.db, deps.events, job.orgId, row.conversation.id)
      await recordTrace(deps.db, job, decision.trace)
      return { replied: sent, decision: 'reply' }
    }
  }
}

/**
 * Tells staff a chat needs them (spec §11.6): a live banner in open inboxes
 * and a push notification like "Handoff: Ravi Kumar, fee installment ke baare
 * mein poochh rahe hain" that opens the chat when tapped.
 */
async function announceHandoff(deps: Deps, job: AiReplyJob, reason: string, summary: string) {
  const [contact] = await deps.db
    .select({ name: contacts.name, profileName: contacts.profileName, waId: contacts.waId })
    .from(conversations)
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
    .where(eq(conversations.id, job.conversationId))
  const who = contact?.name || contact?.profileName || `+${contact?.waId ?? ''}`
  deps.events.emit(job.orgId, 'handoff', {
    conversationId: job.conversationId,
    reason,
    summary,
    contactName: who,
  })
  await announceConversation(deps.db, deps.events, job.orgId, job.conversationId)
  if (deps.push) {
    await notifyOrg({ db: deps.db, push: deps.push }, job.orgId, 'handoff', {
      title: `Handoff: ${who}`,
      body: summary,
      url: `/chat/${job.conversationId}`,
      tag: `handoff-${job.conversationId}`,
    }).catch((err: Error) => deps.log.warn({ err: err.message }, 'push failed'))
  }
}
