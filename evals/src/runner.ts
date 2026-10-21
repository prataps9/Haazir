import { Readable } from 'node:stream'
import { and, eq } from 'drizzle-orm'
import {
  createToolContext,
  createTools,
  decideReply,
  ingestSource,
  loadFlowContext,
  type Decision,
  type Models,
} from '@haazir/ai-core'
import {
  contacts,
  conversations,
  courses,
  knowledgeFaqs,
  knowledgeSources,
  messages,
  whatsappAccounts,
  type AnyDatabase,
  organizations,
} from '@haazir/db'
import { seed } from '@haazir/db/seed'
import { createTestDb } from '@haazir/db/testing'
import type { EvalCase } from './cases'
import { evaluateTurn, type CaseResult } from './score'

/**
 * The "shiksha-sikar" fixture: the seeded demo institute in a throwaway
 * in-process Postgres, its FAQs embedded with the configured model.
 */
export async function createFixture(models: Models) {
  const { db, close } = await createTestDb()
  const { org } = await seed(db)
  const [account] = await db
    .insert(whatsappAccounts)
    .values({ orgId: org.id, wabaId: 'eval', phoneNumberId: 'eval', accessTokenEnc: 'v1.a.b.c' })
    .returning()
  for (const source of await db
    .select()
    .from(knowledgeSources)
    .where(eq(knowledgeSources.orgId, org.id))) {
    await ingestSource(
      { db, embedding: models.embedding, readFile: async () => Readable.from([]) },
      org.id,
      source.id,
    )
  }
  return {
    db,
    orgId: org.id,
    accountId: account!.id,
    factsCorpus: await factsCorpus(db, org.id),
    close,
  }
}

/**
 * Everything the institute's data says, as text: every tool's output for
 * every course, the FAQs, address and hours. A number in a reply that isn't
 * in here (or in the question) was invented.
 */
export async function factsCorpus(db: AnyDatabase, orgId: string): Promise<string> {
  const [orgRow] = await db.select().from(organizations).where(eq(organizations.id, orgId))
  const flow = await loadFlowContext(db, orgRow!, new Date(), 'hinglish', null)
  const ctx = await createToolContext(db, orgRow!, { contactId: orgId, flow })
  const tools = createTools(ctx)
  const call = (name: keyof typeof tools, input: object) =>
    (tools[name].execute as (i: object, o: object) => Promise<unknown>)(input, {
      toolCallId: 'x',
      messages: [],
    })
  await call('get_courses', {})
  for (const c of await db.select().from(courses).where(eq(courses.orgId, orgId))) {
    await call('get_course_details', { course: c.shortName })
    await call('get_batches', { course: c.shortName })
    await call('check_demo_slots', { course: c.shortName })
  }
  const faqs = await db.select().from(knowledgeFaqs).where(eq(knowledgeFaqs.orgId, orgId))
  const [org] = await db.query.organizations.findMany({ where: (o, { eq }) => eq(o.id, orgId) })
  return [
    ...ctx.facts,
    ...faqs.map((f) => `${f.question} ${f.answer}`),
    org?.address ?? '',
    JSON.stringify(org?.businessHours ?? {}),
    '8:00 AM 8:00 PM 9:00 AM 1:00 PM 12:00 PM', // business hours as people write them
  ].join('\n')
}

export async function runCase(
  fixture: { db: AnyDatabase; orgId: string; accountId: string; factsCorpus: string },
  models: Models,
  evalCase: EvalCase,
): Promise<CaseResult> {
  const { db, orgId } = fixture
  const [contact] = await db
    .insert(contacts)
    .values({ orgId, waId: `eval-${evalCase.id}`, profileName: 'Eval' })
    .returning()
  const [conversation] = await db
    .insert(conversations)
    .values({ orgId, contactId: contact!.id, whatsappAccountId: fixture.accountId })
    .returning()

  const turns = []
  try {
    for (const turn of evalCase.turns) {
      const [message] = await db
        .insert(messages)
        .values({
          orgId,
          conversationId: conversation!.id,
          direction: 'in',
          type: turn.interactive_id ? 'interactive' : turn.type,
          body: turn.type === 'audio' ? null : turn.user,
          transcript: turn.type === 'audio' ? turn.user : null,
          interactive: turn.interactive_id
            ? { kind: 'button_reply', id: turn.interactive_id, title: turn.user }
            : null,
        })
        .returning()

      const decision: Decision = await decideReply(
        { db, models, now: () => new Date() },
        { orgId, conversationId: conversation!.id, messageId: message!.id },
      )
      turns.push(evaluateTurn(turn.expect, decision, turn.user, fixture.factsCorpus))

      // Keep the conversation going as the worker would, so follow-ups have history.
      if ('content' in decision) {
        await db.insert(messages).values({
          orgId,
          conversationId: conversation!.id,
          direction: 'out',
          type: 'text',
          body: decision.content.body,
          sentBy: 'bot',
          status: 'read',
        })
      }
      if (decision.kind === 'reply') {
        await db
          .update(conversations)
          .set({
            flowState:
              decision.kind === 'reply' && decision.flowState ? { ...decision.flowState } : null,
          })
          .where(and(eq(conversations.id, conversation!.id), eq(conversations.orgId, orgId)))
      }
    }
    return { case: evalCase, turns, passed: turns.every((t) => t.failures.length === 0) }
  } catch (err) {
    return { case: evalCase, turns, passed: false, error: (err as Error).message }
  }
}

/** Runs cases with limited parallelism: providers rate-limit bursts. */
export async function runCases(
  fixture: Parameters<typeof runCase>[0],
  models: Models,
  cases: EvalCase[],
  { concurrency = 4, onResult }: { concurrency?: number; onResult?(r: CaseResult): void } = {},
) {
  const results: CaseResult[] = new Array(cases.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, cases.length) }, async () => {
      while (next < cases.length) {
        const i = next++
        results[i] = await runCase(fixture, models, cases[i]!)
        onResult?.(results[i]!)
      }
    }),
  )
  return results
}
