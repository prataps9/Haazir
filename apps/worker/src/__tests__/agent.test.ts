import { and, eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { admitStudent, type RazorpayFactory } from '@haazir/coaching'
import {
  contacts,
  conversations,
  courses,
  demoBookings,
  feeInstallments,
  leadEvents,
  leads,
  messages,
  orgPaymentAccounts,
  templates,
} from '@haazir/db'
import { encryptSecret } from '@haazir/shared/crypto'
import { applyActions } from '../agent'
import { processAiReply } from '../processors/aiReply'
import { processInbound } from '../processors/inbound'
import { processOutbound } from '../processors/outbound'
import { feeSweep, processReminder } from '../processors/reminder'
import { createHarness, inboundTap, inboundText, mockGraph } from './harness'

const graph = mockGraph()
let h: Awaited<ReturnType<typeof createHarness>>
// Saturday 26 Sep 2026, 12:51 PM IST (the harness clock).
const ts = (n: number) => 1790407200 + n * 10

beforeAll(() => graph.server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => graph.server.close())
beforeEach(async () => {
  h = await createHarness()
  h.deps.models = null // the agent's flows need no AI
})
afterEach(async () => {
  graph.reset()
  await h.close()
})

async function runQueues() {
  for (const job of h.queues.aiReply.jobs.splice(0)) await processAiReply(h.deps, job.data)
  for (const job of h.queues.outbound.jobs.splice(0)) await processOutbound(h.deps, job.data)
}

const lastSent = () =>
  graph.sent.at(-1)!.body as {
    type: string
    interactive?: {
      body: { text: string }
      action: {
        buttons?: { reply: { id: string; title: string } }[]
        sections?: { rows: { id: string; title: string }[] }[]
      }
    }
    text?: { body: string }
    template?: {
      name: string
      components: { type: string; parameters: { payload?: string; text?: string }[] }[]
    }
    document?: { id: string; filename: string }
  }
const rows = () => lastSent().interactive!.action.sections!.flatMap((s) => s.rows)
let n = 0
const tap = async (replyId: string, title: string, list = true) => {
  await processInbound(h.deps, {
    payload: inboundTap({ id: `wamid.T${++n}`, replyId, title, list, ts: ts(n) }),
  })
  await runQueues()
}

describe('the agent books a demo over WhatsApp', () => {
  it('from the first message to a booking, a lead, reminders and a confirmation', async () => {
    await processInbound(h.deps, { payload: inboundText({ id: 'wamid.IN1', body: 'Namaste' }) })
    await runQueues()
    // Every enquiry is a lead from its first message.
    const [lead] = await h.db.select().from(leads).where(eq(leads.orgId, h.org.id))
    expect(lead).toMatchObject({ stage: 'new', source: 'whatsapp' })
    expect(h.emitted.some((e) => e.event === 'lead:updated')).toBe(true)
    expect(lastSent().interactive!.action.buttons!.map((b) => b.reply.id)).toEqual([
      'menu_courses',
      'menu_demo',
      'menu_talk',
    ])

    await tap('menu_demo', 'Free demo', false)
    await tap(rows().find((r) => r.title === 'RS-CIT')!.id, 'RS-CIT')
    // Monday, so both the morning and the evening batch run: a time question follows.
    const monday = rows().find((r) => r.id === 'demo_day:2026-09-28')!
    await tap(monday.id, monday.title)
    await tap(rows().find((r) => r.title.startsWith('8:00 AM'))!.id, '8:00 AM–9:30 AM')
    expect(lastSent().interactive!.action.buttons).toEqual([
      { type: 'reply', reply: { id: 'demo_name', title: 'Anil Kumar' } },
    ])
    await tap('demo_name', 'Anil Kumar', false)
    expect(lastSent().interactive!.body.text).toContain('Anil Kumar')
    await tap('demo_yes', 'Haan, book karo', false)

    const [booking] = await h.db.select().from(demoBookings)
    expect(booking).toMatchObject({
      studentName: 'Anil Kumar',
      status: 'booked',
      bookedBy: 'bot',
      startsAt: new Date('2026-09-28T02:30:00Z'), // 8 AM IST
    })
    expect(lastSent().text!.body).toContain('Namaste Anil Kumar ji')
    expect(lastSent().text!.body).toContain('Station Road')

    const [after] = await h.db.select().from(leads).where(eq(leads.id, lead!.id))
    expect(after).toMatchObject({ stage: 'demo_booked', studentName: 'Anil Kumar' })
    const timeline = await h.db.select().from(leadEvents).where(eq(leadEvents.leadId, lead!.id))
    expect(timeline.map((e) => e.type)).toEqual(['created', 'demo_booked'])

    // Reminder 3 hours before (5 AM IST is quiet hours; the job moves it to 8 AM itself), follow-up a day after.
    expect(h.queues.reminder.jobs.map((j) => [j.name, j.opts?.jobId])).toEqual([
      ['demo_reminder', `demo-reminder-${booking!.id}`],
      ['demo_followup', `demo-followup-${booking!.id}`],
    ])
    const reminderDelay = h.queues.reminder.jobs[0]!.opts!.delay!
    expect(new Date(h.deps.now().getTime() + reminderDelay)).toEqual(
      new Date('2026-09-27T23:30:00Z'),
    )
  })

  it('tapping "book" twice books once', async () => {
    const [rscit] = await h.db.select().from(courses).where(eq(courses.shortName, 'RS-CIT'))
    await tap('menu_demo', 'Free demo', false)
    await tap(`demo_course:${rscit!.id}`, 'RS-CIT')
    await tap('demo_day:2026-09-28', 'Somvar')
    await tap(rows()[0]!.id, rows()[0]!.title)
    await tap('demo_name', 'Anil Kumar', false)
    const confirmState = (await h.db.select().from(conversations))[0]!.flowState
    await tap('demo_yes', 'Haan, book karo', false)
    // A double tap lands on the same confirm step again.
    await h.db.update(conversations).set({ flowState: confirmState })
    await tap('demo_yes', 'Haan, book karo', false)
    expect(await h.db.$count(demoBookings)).toBe(1)
  })
})

describe('reminders', () => {
  async function bookedDemo(startsAt: Date) {
    const [rscit] = await h.db.select().from(courses).where(eq(courses.shortName, 'RS-CIT'))
    await processInbound(h.deps, { payload: inboundText({ id: 'wamid.IN1', body: 'Namaste' }) })
    await runQueues()
    const [contact] = await h.db.select().from(contacts)
    const [lead] = await h.db.select().from(leads)
    const [booking] = await h.db
      .insert(demoBookings)
      .values({
        orgId: h.org.id,
        leadId: lead!.id,
        contactId: contact!.id,
        courseId: rscit!.id,
        studentName: 'Anil Kumar',
        startsAt,
      })
      .returning()
    return booking!
  }

  it('inside the window: the reminder goes as buttons that point back at the booking', async () => {
    const booking = await bookedDemo(new Date('2026-09-26T11:30:00Z')) // 5 PM IST today
    await processReminder(h.deps, { kind: 'demo_reminder', orgId: h.org.id, bookingId: booking.id })
    for (const job of h.queues.outbound.jobs.splice(0)) await processOutbound(h.deps, job.data)
    expect(lastSent().interactive!.body.text).toBe(
      'Yaad dilana tha: aaj 5:00 PM baje aapki RS-CIT demo class hai. Aa rahe hain?',
    )
    expect(lastSent().interactive!.action.buttons!.map((b) => b.reply.id)).toEqual([
      `demo_yes:${booking.id}`,
      `demo_reschedule:${booking.id}`,
    ])
    const [after] = await h.db.select().from(demoBookings)
    expect(after!.status).toBe('reminded')

    // "Haan" on the reminder: thanked, noted on the lead's timeline.
    await tap(`demo_yes:${booking.id}`, 'Haan, aa raha hoon', false)
    expect(lastSent().text!.body).toContain('Badhiya! Milte hain')
    const notes = await h.db.select().from(leadEvents).where(eq(leadEvents.type, 'note'))
    expect(notes[0]!.note).toBe('Demo ke liye aa rahe hain')
  })

  it('outside the window it needs an approved template, with the booking in the button payload', async () => {
    const booking = await bookedDemo(new Date('2026-09-28T11:30:00Z'))
    h.setNow(new Date('2026-09-28T08:30:00Z')) // 2 PM Monday: the 24h window from Saturday has closed

    expect(
      await processReminder(h.deps, {
        kind: 'demo_reminder',
        orgId: h.org.id,
        bookingId: booking.id,
      }),
    ).toEqual({ sent: false, reason: 'no_template' })

    await h.db
      .update(templates)
      .set({ status: 'approved' })
      .where(and(eq(templates.orgId, h.org.id), eq(templates.purpose, 'demo_reminder')))
    await processReminder(h.deps, { kind: 'demo_reminder', orgId: h.org.id, bookingId: booking.id })
    for (const job of h.queues.outbound.jobs.splice(0)) await processOutbound(h.deps, job.data)
    const sent = lastSent().template!
    expect(sent.name).toBe('demo_reminder_hinglish')
    expect(sent.components[0]!.parameters.map((p) => p.text)).toEqual(['5:00 PM', 'RS-CIT'])
    expect(sent.components[1]!.parameters[0]!.payload).toBe(`demo_yes:${booking.id}`)
  })

  it('a cancelled or past demo sends nothing', async () => {
    const booking = await bookedDemo(new Date('2026-09-26T11:30:00Z'))
    await h.db.update(demoBookings).set({ status: 'cancelled' })
    expect(
      await processReminder(h.deps, {
        kind: 'demo_reminder',
        orgId: h.org.id,
        bookingId: booking.id,
      }),
    ).toEqual({ sent: false, reason: 'not_needed' })
    expect(h.queues.outbound.jobs).toHaveLength(0)
  })

  it("the follow-up only goes to people who came and haven't joined", async () => {
    const booking = await bookedDemo(new Date('2026-09-25T11:30:00Z'))
    const job = { kind: 'demo_followup' as const, orgId: h.org.id, bookingId: booking.id }
    expect(await processReminder(h.deps, job)).toEqual({ sent: false, reason: 'not_needed' })
    await h.db.update(demoBookings).set({ status: 'attended' })
    await h.db.update(leads).set({ stage: 'demo_done' })
    expect(await processReminder(h.deps, job)).toEqual({ sent: true })
  })
})

describe('the daily fee sweep', () => {
  const links: { amount: number; reference: string }[] = []
  const razorpay: RazorpayFactory = () => ({
    createPaymentLink: async (input) => {
      links.push({ amount: input.amountPaise, reference: input.referenceId })
      return {
        id: `plink_${links.length}`,
        shortUrl: `https://rzp.io/i/${links.length}`,
        status: 'created',
      }
    },
    check: async () => {},
  })

  async function studentWithFeeDueIn(days: number) {
    await processInbound(h.deps, { payload: inboundText({ id: 'wamid.IN1', body: 'Namaste' }) })
    await runQueues()
    const [contact] = await h.db.select().from(contacts)
    const [web] = await h.db.select().from(courses).where(eq(courses.shortName, 'Web Development'))
    // Admitted 60 days before the second installment falls due.
    const admission = new Date(Date.UTC(2026, 8, 26 + days - 60)).toISOString().slice(0, 10)
    const { installments } = await admitStudent(h.db, {
      orgId: h.org.id,
      contactId: contact!.id,
      name: 'Anil Kumar',
      courseId: web!.id,
      admissionDate: admission,
      today: '2026-09-26',
      actor: 'system',
    })
    await h.db
      .update(feeInstallments)
      .set({ status: 'paid' })
      .where(eq(feeInstallments.id, installments[0]!.id))
    return installments[1]!
  }

  beforeEach(async () => {
    links.length = 0
    h.deps.razorpay = razorpay
    await h.db.insert(orgPaymentAccounts).values({
      orgId: h.org.id,
      keyId: 'rzp_test_1',
      keySecretEnc: encryptSecret('secret', h.deps.encryptionKey!),
      webhookSecretEnc: encryptSecret('whsec', h.deps.encryptionKey!),
    })
  })

  it('3 days before: one reminder with a fresh payment link, and never twice', async () => {
    const inst = await studentWithFeeDueIn(3)
    const first = await feeSweep(h.deps, h.org.id)
    expect(first.sent).toBe(1)
    for (const job of h.queues.outbound.jobs.splice(0)) await processOutbound(h.deps, job.data)
    expect(lastSent().text!.body).toBe(
      'Anil Kumar ki Web Development fees ₹6,000 ki kisht 29 Sep ko due hai. Pay karne ke liye: https://rzp.io/i/1',
    )
    expect(links).toEqual([{ amount: 6_000_00, reference: inst.id }])

    const again = await feeSweep(h.deps, h.org.id)
    expect(again.sent).toBe(0)
    expect(links).toHaveLength(1)
  })

  it('moves the installment to overdue, and chases it on day 3 and day 7', async () => {
    const inst = await studentWithFeeDueIn(-3)
    await feeSweep(h.deps, h.org.id)
    const [row] = await h.db.select().from(feeInstallments).where(eq(feeInstallments.id, inst.id))
    expect(row!.status).toBe('overdue')
    expect(row!.remindersSent.overdue3).toBeTruthy()
    for (const job of h.queues.outbound.jobs.splice(0)) await processOutbound(h.deps, job.data)
    expect(lastSent().text!.body).toContain('fees ₹6,000 baaki hai')
  })

  it('holds the reminder at night, and the opted-out get none', async () => {
    await studentWithFeeDueIn(1)
    h.setNow(new Date('2026-09-26T17:00:00Z')) // 10:30 PM IST
    expect((await feeSweep(h.deps, h.org.id)).skipped).toEqual({ quiet_hours: 1 })
    h.setNow(new Date('2026-09-27T04:30:00Z')) // 10 AM next day
    await h.db.update(contacts).set({ optInStatus: 'opted_out' })
    expect((await feeSweep(h.deps, h.org.id)).skipped).toEqual({ opted_out: 1 })
  })
})

describe('agent actions', () => {
  it('sends a brochure: uploads the PDF to Meta once, then sends it as a document', async () => {
    await processInbound(h.deps, { payload: inboundText({ id: 'wamid.IN1', body: 'Namaste' }) })
    await runQueues()
    const [rscit] = await h.db.select().from(courses).where(eq(courses.shortName, 'RS-CIT'))
    await h.deps.storage.put(
      'orgs/x/rscit.pdf',
      Buffer.from('%PDF-1.4 brochure'),
      'application/pdf',
    )
    await h.db
      .update(courses)
      .set({ brochureKey: 'orgs/x/rscit.pdf' })
      .where(eq(courses.id, rscit!.id))
    const [conversation] = await h.db.select().from(conversations)
    const [msg] = await h.db.select().from(messages).limit(1)
    await applyActions(
      h.deps,
      {
        orgId: h.org.id,
        conversationId: conversation!.id,
        contactId: conversation!.contactId,
        messageId: msg!.id,
      },
      [{ type: 'send_brochure', courseId: rscit!.id }],
    )
    for (const job of h.queues.outbound.jobs.splice(0)) await processOutbound(h.deps, job.data)
    expect(graph.uploads).toEqual([{ filename: 'RS-CIT.pdf', type: 'application/pdf' }])
    expect(lastSent()).toMatchObject({
      type: 'document',
      document: { id: 'media-1', filename: 'RS-CIT.pdf' },
    })
  })

  it('one failing action does not stop the rest', async () => {
    await processInbound(h.deps, { payload: inboundText({ id: 'wamid.IN1', body: 'Namaste' }) })
    await runQueues()
    const [conversation] = await h.db.select().from(conversations)
    const [msg] = await h.db.select().from(messages).limit(1)
    const done = await applyActions(
      h.deps,
      {
        orgId: h.org.id,
        conversationId: conversation!.id,
        contactId: conversation!.contactId,
        messageId: msg!.id,
      },
      [
        {
          type: 'book_demo',
          courseId: 'not-a-uuid',
          batchId: 'x',
          date: '2026-09-28',
          startTime: '08:00',
          studentName: 'A',
        },
        { type: 'send_location' },
      ],
    )
    expect(done).toEqual(['send_location'])
    expect(h.queues.outbound.jobs.length).toBeGreaterThan(0)
  })
})
