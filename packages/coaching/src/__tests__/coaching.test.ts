import { createHmac } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  batches,
  contacts,
  courses,
  demoBookings,
  feeInstallments,
  leadEvents,
  leads,
  type AnyDatabase,
} from '@haazir/db'
import { seed } from '@haazir/db/seed'
import { createTestDb } from '@haazir/db/testing'
import {
  admitStudent,
  bookDemo,
  createRazorpay,
  demoReminderTimes,
  ensureLead,
  feeReminderDue,
  istInstant,
  markDemo,
  moveLead,
  parsePaymentLinkPaid,
  recordPayment,
  refreshFeeStatuses,
  verifyRazorpaySignature,
} from '../index'

let db: AnyDatabase
let close: () => Promise<void>
let orgId: string
let ownerId: string

const newContact = async (waId: string, name = 'Test Person') => {
  const [c] = await db.insert(contacts).values({ orgId, waId, name }).returning()
  return c!
}
const course = async (short: string) =>
  (
    await db
      .select()
      .from(courses)
      .where(and(eq(courses.orgId, orgId), eq(courses.shortName, short)))
  )[0]!

beforeAll(async () => {
  ;({ db, close } = await createTestDb())
  const s = await seed(db, { crm: true })
  orgId = s.org.id
  ownerId = s.owner.id
})
afterAll(() => close())

describe('leads', () => {
  it('opens one lead per contact, fills in what it learns, and logs it', async () => {
    const c = await newContact('911000009001')
    const rscit = await course('RS-CIT')
    const first = await ensureLead(db, { orgId, contactId: c.id, actor: 'bot' })
    const again = await ensureLead(db, { orgId, contactId: c.id, courseId: rscit.id, actor: 'bot' })
    expect(again!.id).toBe(first!.id)
    expect(again!.courseId).toBe(rscit.id)
    expect(first!.stage).toBe('new')
    const events = await db.select().from(leadEvents).where(eq(leadEvents.leadId, first!.id))
    expect(events.map((e) => e.type)).toEqual(['created'])
  })

  it("doesn't open leads for students writing in", async () => {
    const c = await newContact('911000009002', 'Asha')
    await admitStudent(db, {
      orgId,
      contactId: c.id,
      name: 'Asha',
      courseId: (await course('RS-CIT')).id,
      admissionDate: '2026-10-01',
      today: '2026-10-21',
      actor: 'user',
      actorUserId: ownerId,
    })
    expect(await ensureLead(db, { orgId, contactId: c.id, actor: 'bot' })).toBeNull()
  })

  it('automatic moves only go forward, but staff can move a lead anywhere', async () => {
    const c = await newContact('911000009003')
    const lead = (await ensureLead(db, { orgId, contactId: c.id, actor: 'bot' }))!
    await moveLead(db, {
      orgId,
      leadId: lead.id,
      to: 'admitted',
      actor: 'user',
      actorUserId: ownerId,
    })
    const bot = await moveLead(db, {
      orgId,
      leadId: lead.id,
      to: 'demo_booked',
      onlyForward: true,
      actor: 'bot',
    })
    expect(bot!.stage).toBe('admitted')
    const staff = await moveLead(db, {
      orgId,
      leadId: lead.id,
      to: 'lost',
      lostReason: 'fees_high',
      actor: 'user',
      actorUserId: ownerId,
    })
    expect(staff).toMatchObject({ stage: 'lost', lostReason: 'fees_high' })
  })
})

describe('demo booking', () => {
  it('books once per person and slot, and moves the lead to demo booked', async () => {
    const c = await newContact('911000009004', 'Ravi')
    const rscit = await course('RS-CIT')
    const [batch] = await db.select().from(batches).where(eq(batches.courseId, rscit.id))
    const startsAt = istInstant('2026-10-22', batch!.startTime)
    const input = {
      orgId,
      contactId: c.id,
      courseId: rscit.id,
      batchId: batch!.id,
      startsAt,
      studentName: 'Ravi Meena',
      actor: 'bot' as const,
    }
    const a = await bookDemo(db, input)
    const b = await bookDemo(db, input)
    expect(a.created).toBe(true)
    expect(b).toEqual({ booking: a.booking, created: false })
    expect(await db.$count(demoBookings, eq(demoBookings.contactId, c.id))).toBe(1)
    const [lead] = await db.select().from(leads).where(eq(leads.contactId, c.id))
    expect(lead).toMatchObject({
      stage: 'demo_booked',
      batchId: batch!.id,
      studentName: 'Ravi Meena',
    })

    const marked = await markDemo(db, {
      orgId,
      demoId: a.booking.id,
      status: 'attended',
      actor: 'user',
      actorUserId: ownerId,
    })
    expect(marked!.status).toBe('attended')
    expect((await db.select().from(leads).where(eq(leads.id, lead!.id)))[0]!.stage).toBe(
      'demo_done',
    )
  })

  it('reminds 3 hours before (or now, if booked later than that) and follows up a day after', () => {
    const startsAt = new Date('2026-10-22T02:30:00Z') // 8:00 AM IST
    expect(demoReminderTimes(startsAt, new Date('2026-10-21T10:00:00Z'))).toEqual({
      reminder: new Date('2026-10-21T23:30:00Z'),
      followup: new Date('2026-10-23T02:30:00Z'),
    })
    const late = new Date('2026-10-22T01:00:00Z')
    expect(demoReminderTimes(startsAt, late).reminder).toEqual(late)
    expect(demoReminderTimes(startsAt, new Date('2026-10-22T03:00:00Z')).reminder).toBeNull()
  })

  it("can't book across orgs: another org's lead never moves", async () => {
    const markedElsewhere = await markDemo(db, {
      orgId: '00000000-0000-0000-0000-000000000000',
      demoId: (await db.select().from(demoBookings).limit(1))[0]!.id,
      status: 'no_show',
      actor: 'bot',
    })
    expect(markedElsewhere).toBeNull()
  })
})

describe('admission and fees', () => {
  it('admits a student: installments from the plan, a seat filled, the lead admitted', async () => {
    const c = await newContact('911000009005', 'Komal')
    const web = await course('Web Development')
    const [batch] = await db.select().from(batches).where(eq(batches.courseId, web.id))
    await ensureLead(db, { orgId, contactId: c.id, actor: 'bot' })
    const { student, installments } = await admitStudent(db, {
      orgId,
      contactId: c.id,
      name: 'Komal Prajapat',
      courseId: web.id,
      batchId: batch!.id,
      admissionDate: '2026-10-21',
      today: '2026-10-21',
      actor: 'user',
      actorUserId: ownerId,
    })
    expect(student.name).toBe('Komal Prajapat')
    expect(installments.map((i) => [i.label, i.dueDate, i.amountPaise, i.status])).toEqual([
      ['Pehli kisht', '2026-10-21', 6_000_00, 'due'],
      ['Doosri kisht', '2026-12-20', 6_000_00, 'upcoming'],
      ['Teesri kisht', '2027-02-18', 6_000_00, 'upcoming'],
    ])
    const [after] = await db.select().from(batches).where(eq(batches.id, batch!.id))
    expect(after!.seatsFilled).toBe(batch!.seatsFilled + 1)
    expect((await db.select().from(leads).where(eq(leads.contactId, c.id)))[0]!.stage).toBe(
      'admitted',
    )
  })

  it('knows which reminder is due, and catches up on a missed day without repeating', () => {
    const inst = (dueDate: string, remindersSent = {}) => ({
      dueDate,
      status: 'upcoming' as const,
      remindersSent,
    })
    expect(feeReminderDue(inst('2026-10-24'), '2026-10-21')).toBe('upcoming')
    expect(feeReminderDue(inst('2026-10-24', { upcoming: 'x' }), '2026-10-22')).toBeNull()
    expect(feeReminderDue(inst('2026-10-30'), '2026-10-21')).toBeNull()
    expect(feeReminderDue(inst('2026-10-21'), '2026-10-21')).toBe('due')
    expect(feeReminderDue(inst('2026-10-17'), '2026-10-21')).toBe('overdue3')
    expect(feeReminderDue(inst('2026-10-10', { overdue3: 'x' }), '2026-10-21')).toBe('overdue7')
    expect(feeReminderDue({ ...inst('2026-10-10'), status: 'paid' }, '2026-10-21')).toBeNull()
  })

  it('moves installments to due and overdue as the days pass', async () => {
    const changed = await refreshFeeStatuses(db, orgId, '2027-01-01')
    expect(changed).toBeGreaterThan(0)
    const rows = await db.select().from(feeInstallments).where(eq(feeInstallments.orgId, orgId))
    expect(
      rows
        .filter((r) => r.dueDate < '2027-01-01' && r.status !== 'paid' && r.status !== 'waived')
        .every((r) => r.status === 'overdue'),
    ).toBe(true)
  })

  it('records a payment once, with the next receipt number', async () => {
    const [open1, open2] = await db
      .select()
      .from(feeInstallments)
      .where(and(eq(feeInstallments.orgId, orgId), eq(feeInstallments.status, 'overdue')))
      .limit(2)
    const paidAt = new Date('2026-10-21T06:00:00Z')
    const a = await recordPayment(db, { orgId, installmentId: open1!.id, via: 'razorpay', paidAt })
    const again = await recordPayment(db, {
      orgId,
      installmentId: open1!.id,
      via: 'razorpay',
      paidAt,
    })
    const b = await recordPayment(db, { orgId, installmentId: open2!.id, via: 'cash', paidAt })
    expect(a!.alreadyPaid).toBe(false)
    expect(again!.alreadyPaid).toBe(true)
    expect(again!.installment.receiptNo).toBe(a!.installment.receiptNo)
    const n = (r: string) => Number(r.slice(2))
    expect(n(b!.installment.receiptNo!)).toBe(n(a!.installment.receiptNo!) + 1)
    expect(
      await recordPayment(db, {
        orgId: '00000000-0000-0000-0000-000000000000',
        installmentId: open2!.id,
        via: 'cash',
        paidAt,
      }),
    ).toBeNull()
  })
})

describe('Razorpay', () => {
  it("creates a link with the amount in paise, our reference, and Razorpay's own SMS off", async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const rzp = createRazorpay({
      keyId: 'rzp_test_x',
      keySecret: 'secret',
      fetch: async (url, init) => {
        calls.push({ url: String(url), init: init! })
        return new Response(
          JSON.stringify({ id: 'plink_1', short_url: 'https://rzp.io/i/abc', status: 'created' }),
        )
      },
    })
    const link = await rzp.createPaymentLink({
      amountPaise: 6_000_00,
      description: 'Web Development: Doosri kisht',
      referenceId: 'inst-1',
      customer: { name: 'Komal', phone: '911000009005' },
    })
    expect(link).toEqual({ id: 'plink_1', shortUrl: 'https://rzp.io/i/abc', status: 'created' })
    const body = JSON.parse(String(calls[0]!.init.body))
    expect(calls[0]!.url).toBe('https://api.razorpay.com/v1/payment_links')
    expect(body).toMatchObject({
      amount: 600000,
      currency: 'INR',
      reference_id: 'inst-1',
      notify: { sms: false, email: false },
    })
    expect(body.customer.contact).toBe('+911000009005')
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe(
      `Basic ${Buffer.from('rzp_test_x:secret').toString('base64')}`,
    )
  })

  it('turns a Razorpay error into a readable message', async () => {
    const rzp = createRazorpay({
      keyId: 'k',
      keySecret: 's',
      fetch: async () =>
        new Response(JSON.stringify({ error: { description: 'Authentication failed' } }), {
          status: 401,
        }),
    })
    await expect(rzp.check()).rejects.toThrow('Authentication failed')
  })

  it('verifies webhook signatures and reads payment_link.paid', () => {
    const raw = JSON.stringify({
      event: 'payment_link.paid',
      payload: {
        payment_link: { entity: { id: 'plink_1', reference_id: 'inst-1', amount_paid: 600000 } },
        payment: { entity: { id: 'pay_1', amount: 600000, created_at: 1792569600 } },
      },
    })
    const sig = createHmac('sha256', 'whsec').update(raw).digest('hex')
    expect(verifyRazorpaySignature(raw, sig, 'whsec')).toBe(true)
    expect(verifyRazorpaySignature(raw, sig, 'other')).toBe(false)
    expect(verifyRazorpaySignature(raw, undefined, 'whsec')).toBe(false)
    expect(parsePaymentLinkPaid(JSON.parse(raw))).toEqual({
      paymentLinkId: 'plink_1',
      referenceId: 'inst-1',
      paymentId: 'pay_1',
      amountPaise: 600000,
      paidAt: new Date(1792569600 * 1000),
    })
    expect(parsePaymentLinkPaid({ event: 'payment.captured' })).toBeNull()
  })
})
