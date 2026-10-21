import { and, eq, lte, sql } from 'drizzle-orm'
import {
  aiTraces,
  contacts,
  conversations,
  unansweredQuestions,
  type AnyDatabase,
} from '@haazir/db'
import {
  HUMAN_MODE_MS,
  type Decision,
  type FlowStore,
  type HandoffReason,
  type TraceData,
  type Turn,
} from './pipeline'

/**
 * The writes that follow a decision. Kept apart from decideReply so the
 * playground and evals can decide without changing anything.
 */

export async function recordTrace(
  db: AnyDatabase,
  turn: Turn,
  trace: TraceData,
  handoff?: { reason: HandoffReason },
) {
  await db.insert(aiTraces).values({
    orgId: turn.orgId,
    conversationId: turn.conversationId,
    messageId: turn.messageId,
    intent: trace.intent,
    language: trace.language,
    confidence: trace.confidence,
    retrievedChunkIds: trace.retrievedChunkIds,
    toolCalls: trace.toolCalls,
    model: trace.model,
    promptVersion: trace.promptVersion,
    inputTokens: trace.inputTokens,
    outputTokens: trace.outputTokens,
    latencyMs: trace.latencyMs,
    handedOff: !!handoff,
    handoffReason: handoff?.reason ?? null,
    guardrailFlags: trace.guardrailFlags,
  })
}

/**
 * Human mode: the bot stays quiet until staff reply or 2 hours pass without
 * them (spec §11.1). Push notifications to staff arrive in Phase 3.
 */
export async function markHandoff(
  db: AnyDatabase,
  conversationId: string,
  reason: HandoffReason,
  summary: string,
  now: Date,
) {
  await db
    .update(conversations)
    .set({
      mode: 'human',
      humanUntil: new Date(now.getTime() + HUMAN_MODE_MS),
      handoffReason: reason,
      handoffSummary: summary.slice(0, 200),
      handoffAt: now,
      flowState: null,
    })
    .where(eq(conversations.id, conversationId))
}

/**
 * Human mode that timed out goes back to the bot, and the conversation keeps
 * what the next message needs: a booking in progress, the clarify counter,
 * the reply language.
 */
export async function markBotReplied(
  db: AnyDatabase,
  conversationId: string,
  now: Date,
  flowState: FlowStore | null,
) {
  await db
    .update(conversations)
    .set({ mode: 'bot', humanUntil: null })
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.mode, 'human'),
        lte(conversations.humanUntil, now),
      ),
    )
  await db
    .update(conversations)
    .set({ flowState: flowState ? { ...flowState } : null })
    .where(eq(conversations.id, conversationId))
}

export async function optOutContact(db: AnyDatabase, contactId: string, now: Date) {
  await db
    .update(contacts)
    .set({ optInStatus: 'opted_out', optedOutAt: now })
    .where(eq(contacts.id, contactId))
}

export function normaliseQuestion(q: string) {
  return q
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300)
}

/** Counts a question the bot couldn't answer, for "Bot ko sikhayein" (spec §12). */
export async function recordUnanswered(
  db: AnyDatabase,
  orgId: string,
  question: string,
  now: Date,
) {
  const normalized = normaliseQuestion(question)
  if (!normalized) return
  await db
    .insert(unansweredQuestions)
    .values({ orgId, question: question.slice(0, 500), normalized, lastSeenAt: now })
    .onConflictDoUpdate({
      target: [unansweredQuestions.orgId, unansweredQuestions.normalized],
      set: {
        count: sql`${unansweredQuestions.count} + 1`,
        lastSeenAt: now,
        resolved: false,
      },
    })
}

export type { Decision }
