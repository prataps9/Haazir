import { and, eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  contacts,
  conversations,
  demoBookings,
  leads,
  messages,
  sequenceEnrollments,
  sequenceSteps,
  sequences,
  templates,
  whatsappAccounts,
} from '@haazir/db'
import type { SequenceTrigger } from '@haazir/shared'
import { processReminder, sequenceSweep } from '../processors/reminder'
import { createHarness, mockGraph } from './harness'

const graph = mockGraph()
let h: Awaited<ReturnType<typeof createHarness>>

beforeAll(() => graph.server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => graph.server.close())
beforeEach(async () => {
  h = await createHarness()
})
afterEach(async () => {
  graph.reset()
  await h.close()
})

// Saturday 26 Sep 2026. 10:30 AM IST is inside sending hours; 11 PM is not.
const ON_AT = new Date('2026-09-26T05:00:00Z')
const hours = (n: number) => new Date(ON_AT.getTime() + n * 3_600_000)

/** An approved template a sequence can fill: "Namaste {{1}} ji, demo kaisi lagi? …" */
async function followupTemplate(name = 'followup_hinglish') {
  const [t] = await h.db
    .update(templates)
    .set({ status: 'approved', metaTemplateId: `meta-${name}` })
    .where(and(eq(templates.orgId, h.org.id), eq(templates.name, name)))
    .returning()
  return t!
}

/** A sequence switched on at ON_AT with steps at the given hours after the trigger. */
async function sequence(trigger: SequenceTrigger, delays: number[]) {
  const t = await followupTemplate()
  const [seq] = await h.db
    .insert(sequences)
    .values({ orgId: h.org.id, trigger, enabled: true, enabledAt: ON_AT })
    .returning()
  await h.db.insert(sequenceSteps).values(
    delays.map((delayHours, i) => ({
      orgId: h.org.id,
      sequenceId: seq!.id,
      position: i + 1,
      delayHours,
      templateId: t.id,
    })),
  )
  return seq!
}

let n = 0
/** Someone who enquired `at`, with a conversation whose free window has closed. */
async function enquirer(
  at: Date,
  opts: { optIn?: 'opted_in' | 'opted_out' | 'unknown'; name?: string } = {},
) {
  const [account] = await h.db.select().from(whatsappAccounts)
  const [contact] = await h.db
    .insert(contacts)
    .values({
      orgId: h.org.id,
      waId: `91970000${String(++n).padStart(4, '0')}`,
      name: opts.name ?? 'Sunita',
      optInStatus: opts.optIn ?? 'opted_in',
      lastInboundAt: at,
    })
    .returning()
  const [conversation] = await h.db
    .insert(conversations)
    .values({
      orgId: h.org.id,
      contactId: contact!.id,
      whatsappAccountId: account!.id,
      serviceWindowExpiresAt: new Date(at.getTime() + 24 * 3_600_000),
    })
    .returning()
  const [lead] = await h.db
    .insert(leads)
    .values({ orgId: h.org.id, contactId: contact!.id, createdAt: at })
    .returning()
  return { contact: contact!, conversation: conversation!, lead: lead! }
}

const sweepAt = async (at: Date) => {
  h.setNow(at)
  return sequenceSweep(h.deps, h.org.id)
}
const enrollmentOf = async (leadId: string) =>
  (await h.db.select().from(sequenceEnrollments).where(eq(sequenceEnrollments.leadId, leadId)))[0]
const sentTo = (conversationId: string) =>
  h.db
    .select()
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.direction, 'out')))

describe('follow-up sequences', () => {
  it('sends each step when it is due, as a template once the free window has closed, then finishes', async () => {
    await sequence('no_demo', [26, 72])
    const who = await enquirer(hours(1))

    expect(await sweepAt(hours(2))).toMatchObject({ enrolled: 1, sent: 0 })
    expect(await enrollmentOf(who.lead.id)).toMatchObject({ status: 'active', nextPosition: 1 })

    // 26h after the enquiry: the window (24h) has closed, so it goes as the template.
    expect(await sweepAt(hours(27))).toMatchObject({ sent: 1 })
    const [first] = await sentTo(who.conversation.id)
    expect(first).toMatchObject({ type: 'template', sentBy: 'reminder' })
    expect(first!.body).toContain('Namaste Sunita ji')
    expect(await enrollmentOf(who.lead.id)).toMatchObject({ status: 'active', nextPosition: 2 })

    expect(await sweepAt(hours(50))).toMatchObject({ sent: 0 })
    expect(await sweepAt(hours(73))).toMatchObject({ sent: 1, done: 1 })
    expect(await sentTo(who.conversation.id)).toHaveLength(2)
    expect(await enrollmentOf(who.lead.id)).toMatchObject({ status: 'done', nextRunAt: null })

    // Nothing more, however often the job runs.
    expect(await sweepAt(hours(200))).toMatchObject({ enrolled: 0, sent: 0 })
  })

  it('inside the 24-hour window the same words go as a free message', async () => {
    await sequence('no_demo', [3])
    const who = await enquirer(hours(1))
    await sweepAt(hours(4.5))
    const [m] = await sentTo(who.conversation.id)
    expect(m).toMatchObject({ type: 'text' })
    expect(m!.body).toContain('Namaste Sunita ji')
  })

  it('running the job twice at the same moment sends once', async () => {
    await sequence('no_demo', [3, 48])
    const who = await enquirer(hours(1))
    await sweepAt(hours(5))
    await sweepAt(hours(5))
    expect(await sentTo(who.conversation.id)).toHaveLength(1)
  })

  it('switching it on never messages people who enquired before', async () => {
    await sequence('no_demo', [3])
    const old = await enquirer(new Date(ON_AT.getTime() - 3_600_000))
    expect(await sweepAt(hours(30))).toMatchObject({ enrolled: 0, sent: 0 })
    expect(await enrollmentOf(old.lead.id)).toBeUndefined()
  })

  it('only people who said yes to updates get it; nobody who sent STOP', async () => {
    await sequence('no_demo', [3])
    const unknown = await enquirer(hours(1), { optIn: 'unknown' })
    const stopped = await enquirer(hours(1), { optIn: 'opted_out' })
    expect(await sweepAt(hours(5))).toMatchObject({ sent: 0, stopped: 2 })
    expect(await enrollmentOf(unknown.lead.id)).toMatchObject({
      status: 'stopped',
      stopReason: 'no_consent',
    })
    expect(await enrollmentOf(stopped.lead.id)).toMatchObject({ stopReason: 'opted_out' })
    expect(await h.db.$count(messages, eq(messages.direction, 'out'))).toBe(0)
  })

  it('stops when they reply, book a demo, are admitted, or staff take the chat', async () => {
    await sequence('no_demo', [3, 48])
    const replied = await enquirer(hours(1))
    const booked = await enquirer(hours(1))
    const admitted = await enquirer(hours(1))
    const staff = await enquirer(hours(1))
    await sweepAt(hours(5))
    expect(await h.db.$count(messages, eq(messages.direction, 'out'))).toBe(4)

    await h.db
      .update(contacts)
      .set({ lastInboundAt: hours(6) })
      .where(eq(contacts.id, replied.contact.id))
    await h.db.insert(demoBookings).values({
      orgId: h.org.id,
      contactId: booked.contact.id,
      leadId: booked.lead.id,
      studentName: 'Ravi',
      startsAt: hours(100),
    })
    await h.db.update(leads).set({ stage: 'admitted' }).where(eq(leads.id, admitted.lead.id))
    await h.db
      .update(conversations)
      .set({ mode: 'human', humanUntil: hours(60) })
      .where(eq(conversations.id, staff.conversation.id))

    expect(await sweepAt(hours(50))).toMatchObject({ sent: 0, stopped: 4 })
    expect((await enrollmentOf(replied.lead.id))?.stopReason).toBe('replied')
    expect((await enrollmentOf(booked.lead.id))?.stopReason).toBe('demo_booked')
    expect((await enrollmentOf(admitted.lead.id))?.stopReason).toBe('admitted')
    expect((await enrollmentOf(staff.lead.id))?.stopReason).toBe('staff')
    expect(await h.db.$count(messages, eq(messages.direction, 'out'))).toBe(4)
  })

  it('waits out the night: due at 11 PM, sent after 8 AM', async () => {
    await sequence('no_demo', [3])
    const who = await enquirer(new Date('2026-09-26T14:00:00Z')) // 7:30 PM IST
    const night = new Date('2026-09-26T17:30:00Z') // 11 PM IST
    expect(await sweepAt(night)).toMatchObject({ enrolled: 1, sent: 0, held: 1 })
    expect(await enrollmentOf(who.lead.id)).toMatchObject({ status: 'active', nextPosition: 1 })
    const morning = new Date('2026-09-27T03:00:00Z') // 8:30 AM IST
    expect(await sweepAt(morning)).toMatchObject({ sent: 1 })
  })

  it('a missed demo starts its own sequence, timed from the class', async () => {
    await sequence('demo_missed', [20])
    const who = await enquirer(hours(1))
    await h.db.insert(demoBookings).values({
      orgId: h.org.id,
      contactId: who.contact.id,
      leadId: who.lead.id,
      studentName: 'Ravi',
      startsAt: hours(30),
      status: 'no_show',
    })
    expect(await sweepAt(hours(31))).toMatchObject({ enrolled: 1, sent: 0 })
    expect((await enrollmentOf(who.lead.id))?.baseAt).toEqual(hours(30))
    expect(await sweepAt(hours(51))).toMatchObject({ sent: 1, done: 1 })

    // They book again: no second run of the same sequence for this lead.
    expect(await sweepAt(hours(300))).toMatchObject({ enrolled: 0 })
  })

  it('a lead is in one sequence at a time', async () => {
    await sequence('no_demo', [3, 400])
    const t = await followupTemplate()
    const [second] = await h.db
      .insert(sequences)
      .values({ orgId: h.org.id, trigger: 'demo_no_admission', enabled: true, enabledAt: ON_AT })
      .returning()
    await h.db.insert(sequenceSteps).values({
      orgId: h.org.id,
      sequenceId: second!.id,
      position: 1,
      delayHours: 5,
      templateId: t.id,
    })
    const who = await enquirer(hours(1))
    await sweepAt(hours(5)) // enrolled in no_demo, step 1 sent, step 2 far away
    await h.db.insert(demoBookings).values({
      orgId: h.org.id,
      contactId: who.contact.id,
      leadId: who.lead.id,
      studentName: 'Ravi',
      startsAt: hours(6),
      status: 'attended',
    })
    await sweepAt(hours(7))
    const rows = await h.db
      .select()
      .from(sequenceEnrollments)
      .where(eq(sequenceEnrollments.leadId, who.lead.id))
    expect(rows).toHaveLength(1)
  })

  it('a step whose template lost its approval ends the sequence instead of retrying forever', async () => {
    await sequence('no_demo', [3])
    const who = await enquirer(hours(1))
    await h.db.update(templates).set({ status: 'rejected' }).where(eq(templates.orgId, h.org.id))
    expect(await sweepAt(hours(5))).toMatchObject({ sent: 0, stopped: 1 })
    expect((await enrollmentOf(who.lead.id))?.stopReason).toBe('no_template')
  })

  it('switched off: nobody new is enrolled and those part-way wait', async () => {
    const seq = await sequence('no_demo', [3, 48])
    const who = await enquirer(hours(1))
    await sweepAt(hours(5))
    await h.db.update(sequences).set({ enabled: false }).where(eq(sequences.id, seq.id))
    const late = await enquirer(hours(40))
    expect(await sweepAt(hours(60))).toMatchObject({ enrolled: 0, sent: 0 })
    expect(await enrollmentOf(late.lead.id)).toBeUndefined()
    expect(await enrollmentOf(who.lead.id)).toMatchObject({ status: 'active', nextPosition: 2 })
  })

  it('the hourly job covers every active institute and stays quiet when nothing is on', async () => {
    expect(await processReminder(h.deps, { kind: 'sequence_sweep' })).toEqual({
      enrolled: 0,
      sent: 0,
      stopped: 0,
      done: 0,
      held: 0,
    })
  })
})
