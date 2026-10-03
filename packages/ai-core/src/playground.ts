import { and, eq, inArray } from 'drizzle-orm'
import { contacts, conversations, knowledgeChunks, messages, type AnyDatabase } from '@haazir/db'
import { decideReply, type Decision, type PipelineDeps } from './pipeline'

export interface PlaygroundResult {
  decision: Decision
  /** The documents the answer drew on, for "Bot ne ye jaankari use ki". */
  sources: { id: string; content: string }[]
}

/**
 * The bot's test box and playground (spec §12, §16.11): runs the real
 * pipeline on a private conversation per person, so follow-up questions have
 * context, and never sends anything to WhatsApp or changes the org's data
 * beyond that conversation.
 */
export async function askInPlayground(
  deps: PipelineDeps,
  input: { orgId: string; ownerKey: string; question: string; reset?: boolean },
): Promise<PlaygroundResult> {
  const { db } = deps
  const waId = `playground-${input.ownerKey}`
  await db
    .insert(contacts)
    .values({ orgId: input.orgId, waId, profileName: 'Playground' })
    .onConflictDoNothing()
  const [contact] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.orgId, input.orgId), eq(contacts.waId, waId)))
  await db
    .insert(conversations)
    .values({ orgId: input.orgId, contactId: contact!.id })
    .onConflictDoNothing()
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.orgId, input.orgId), eq(conversations.contactId, contact!.id)))

  if (input.reset) await resetPlayground(db, conversation!.id)

  const [message] = await db
    .insert(messages)
    .values({
      orgId: input.orgId,
      conversationId: conversation!.id,
      direction: 'in',
      type: 'text',
      body: input.question,
    })
    .returning()

  const decision = await decideReply(deps, {
    orgId: input.orgId,
    conversationId: conversation!.id,
    messageId: message!.id,
  })

  if ('content' in decision) {
    await db.insert(messages).values({
      orgId: input.orgId,
      conversationId: conversation!.id,
      direction: 'out',
      type: 'text',
      body: decision.content.body,
      sentBy: 'bot',
      status: 'read',
    })
  }
  // A playground handoff mustn't silence the playground: the bot keeps answering.
  await db
    .update(conversations)
    .set({
      mode: 'bot',
      humanUntil: null,
      flowState:
        decision.kind === 'reply' && decision.clarifyMisses
          ? { clarifyMisses: decision.clarifyMisses }
          : null,
    })
    .where(eq(conversations.id, conversation!.id))

  const ids = 'trace' in decision ? decision.trace.retrievedChunkIds : []
  const sources = ids.length
    ? await db
        .select({ id: knowledgeChunks.id, content: knowledgeChunks.content })
        .from(knowledgeChunks)
        .where(and(inArray(knowledgeChunks.id, ids), eq(knowledgeChunks.orgId, input.orgId)))
    : []
  return { decision, sources }
}

async function resetPlayground(db: AnyDatabase, conversationId: string) {
  await db.delete(messages).where(eq(messages.conversationId, conversationId))
}
