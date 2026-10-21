import { createHmac } from 'node:crypto'
import request from 'supertest'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ensureLead, RazorpayError, type RazorpayFactory } from '@haazir/coaching'
import {
  batches,
  courses,
  demoBookings,
  feeInstallments,
  knowledgeSources,
  leads,
  messages,
  students,
} from '@haazir/db'
import { createTestApp } from './helpers'

const links: { amount: number; reference: string }[] = []
const razorpay: RazorpayFactory = ({ keySecret }) => ({
  check: async () => {
    if (keySecret === 'wrong-secret-123') throw new RazorpayError(401, 'Authentication failed')
  },
  createPaymentLink: async (input) => {
    links.push({ amount: input.amountPaise, reference: input.referenceId })
    return {
      id: `plink_${links.length}`,
      shortUrl: `https://rzp.io/i/${links.length}`,
      status: 'created',
    }
  },
})

let t: Awaited<ReturnType<typeof createTestApp>>
beforeAll(async () => {
  t = await createTestApp({ razorpay })
})
afterAll(() => t.close())

const courseOf = async (orgId: string, short: string) =>
  (
    await t.db
      .select()
      .from(courses)
      .where(and(eq(courses.orgId, orgId), eq(courses.shortName, short)))
  )[0]!

describe('courses and batches', () => {
  it('saves a course only when the installments add up to the fee', async () => {
    const owner = await t.login(t.users.owner)
    const base = {
      name: 'Digital Marketing',
      shortName: 'Digital Marketing',
      feeTotalPaise: 12_000_00,
      durationText: '3 mahine',
    }
    const bad = await owner.post('/api/v1/courses').send({
      ...base,
      installmentPlan: [{ label: 'Pehli kisht', amountPaise: 5_000_00, dueOffsetDays: 0 }],
    })
    expect(bad.status).toBe(400)
    expect(bad.body.error.message).toContain('add up to the course fee')
    const long = await owner
      .post('/api/v1/courses')
      .send({ ...base, shortName: 'Digital Marketing Advanced Pro' })
    expect(long.status).toBe(400)

    const ok = await owner.post('/api/v1/courses').send({
      ...base,
      installmentPlan: [
        { label: 'Pehli kisht', amountPaise: 6_000_00, dueOffsetDays: 0 },
        { label: 'Doosri kisht', amountPaise: 6_000_00, dueOffsetDays: 30 },
      ],
    })
    expect(ok.status).toBe(201)

    const batch = await owner.post('/api/v1/batches').send({
      courseId: ok.body.id,
      name: 'DM Shaam',
      days: ['mon', 'wed', 'fri'],
      startTime: '18:00',
      endTime: '19:30',
      startDate: '2026-11-02',
      seatsTotal: 20,
    })
    expect(batch.status).toBe(201)
    expect(batch.body.startTime).toBe('18:00:00')
    const list = await owner.get('/api/v1/courses')
    const dm = list.body.courses.find((c: { id: string }) => c.id === ok.body.id)
    expect(dm.batches).toHaveLength(1)
  })

  it('only owners and admins change courses; agents read them', async () => {
    const staff = await t.login(t.users.staff)
    expect((await staff.get('/api/v1/courses')).status).toBe(200)
    expect(
      (await staff.post('/api/v1/courses').send({ name: 'X', shortName: 'X', feeTotalPaise: 1 }))
        .status,
    ).toBe(403)
  })

  it('a brochure upload is stored for the bot to send, and the bot learns it', async () => {
    const owner = await t.login(t.users.owner)
    const rscit = await courseOf(t.orgA.org.id, 'RS-CIT')
    t.rec.ingest.length = 0
    const res = await owner
      .post(`/api/v1/courses/${rscit.id}/brochure`)
      .attach('file', Buffer.from('%PDF-1.4 RS-CIT'), {
        filename: 'rscit.pdf',
        contentType: 'application/pdf',
      })
    expect(res.status).toBe(201)
    expect((await courseOf(t.orgA.org.id, 'RS-CIT')).brochureKey).toBe(
      `orgs/${t.orgA.org.id}/courses/${rscit.id}/brochure.pdf`,
    )
    const [source] = await t.db
      .select()
      .from(knowledgeSources)
      .where(eq(knowledgeSources.id, res.body.knowledgeSourceId))
    expect(source).toMatchObject({ type: 'pdf', title: 'RS-CIT brochure' })
    expect(t.rec.ingest).toEqual([{ orgId: t.orgA.org.id, sourceId: source!.id }])
  })
})

describe('leads, demos and admission', () => {
  let leadId: string
  beforeAll(async () => {
    const lead = await ensureLead(t.db, {
      orgId: t.orgA.org.id,
      contactId: t.orgA.contact.id,
      actor: 'bot',
    })
    leadId = lead!.id
  })

  it('a staff reply moves a new enquiry to contacted', async () => {
    const staff = await t.login(t.users.staff)
    await staff
      .post(`/api/v1/conversations/${t.orgA.conversation.id}/messages`)
      .send({ text: 'Namaste ji' })
    const res = await staff.get(`/api/v1/leads/${leadId}`)
    expect(res.body.stage).toBe('contacted')
    expect(res.body.events.map((e: { type: string }) => e.type)).toEqual(['created', 'stage'])
    expect(res.body.events[1].actorName).toBe('Pooja Verma')
  })

  it('books a demo: reminders scheduled, confirmation sent, lead moved; booking twice is one booking', async () => {
    const owner = await t.login(t.users.owner)
    const rscit = await courseOf(t.orgA.org.id, 'RS-CIT')
    const [batch] = await t.db.select().from(batches).where(eq(batches.courseId, rscit.id))
    const date = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10)
    t.rec.outbound.length = 0
    t.rec.reminder.length = 0
    const body = { leadId, batchId: batch!.id, date, studentName: 'Anil Kumar' }
    const first = await owner.post('/api/v1/demos').send(body)
    expect(first.status).toBe(201)
    expect(first.body).toMatchObject({
      studentName: 'Anil Kumar',
      status: 'booked',
      bookedBy: 'user',
      courseName: 'RS-CIT',
    })
    expect(t.rec.reminder.map((r) => r.data.kind)).toEqual(['demo_reminder', 'demo_followup'])
    expect(t.rec.outbound).toHaveLength(1)
    const [confirmation] = await t.db
      .select()
      .from(messages)
      .where(eq(messages.id, t.rec.outbound[0]!.messageId))
    expect(confirmation!.body).toContain('Namaste Anil Kumar ji')

    expect((await owner.post('/api/v1/demos').send(body)).status).toBe(200)
    expect(await t.db.$count(demoBookings, eq(demoBookings.leadId, leadId))).toBe(1)

    const day = await owner.get(`/api/v1/demos?date=${date}`)
    expect(day.body.demos).toHaveLength(1)
    const attended = await owner
      .patch(`/api/v1/demos/${first.body.id}`)
      .send({ status: 'attended' })
    expect(attended.body.status).toBe('attended')
    expect((await owner.get(`/api/v1/leads/${leadId}`)).body.stage).toBe('demo_done')
  })

  it('moving to lost needs a reason; admitted goes through "Admit"', async () => {
    const owner = await t.login(t.users.owner)
    expect((await owner.post(`/api/v1/leads/${leadId}/stage`).send({ stage: 'lost' })).status).toBe(
      400,
    )
    expect(
      (await owner.post(`/api/v1/leads/${leadId}/stage`).send({ stage: 'admitted' })).status,
    ).toBe(400)
  })

  it('admits the lead: a student with installments from the course plan', async () => {
    const owner = await t.login(t.users.owner)
    const web = await courseOf(t.orgA.org.id, 'Web Development')
    const res = await owner
      .post(`/api/v1/leads/${leadId}/admit`)
      .send({ name: 'Anil Kumar', courseId: web.id, admissionDate: '2026-10-01' })
    expect(res.status).toBe(201)
    expect(
      res.body.installments.map((i: { label: string; amountPaise: number }) => [
        i.label,
        i.amountPaise,
      ]),
    ).toEqual([
      ['Pehli kisht', 6_000_00],
      ['Doosri kisht', 6_000_00],
      ['Teesri kisht', 6_000_00],
    ])
    expect((await owner.get(`/api/v1/leads/${leadId}`)).body.stage).toBe('admitted')
    const list = await owner.get('/api/v1/leads?stage=admitted')
    expect(list.body.leads.map((l: { id: string }) => l.id)).toContain(leadId)
    expect(list.body.counts.admitted).toBeGreaterThanOrEqual(1)

    const student = await owner.get(`/api/v1/students/${res.body.student.id}`)
    expect(student.body.installments).toHaveLength(3)
    expect(student.body.course.shortName).toBe('Web Development')
  })

  it('exports leads as CSV that Excel opens safely', async () => {
    const owner = await t.login(t.users.owner)
    await owner.patch(`/api/v1/leads/${leadId}`).send({ studentName: '=HYPERLINK("x")' })
    const res = await owner.get('/api/v1/leads/export')
    expect(res.headers['content-type']).toContain('text/csv')
    expect(res.text.charCodeAt(0)).toBe(0xfeff)
    expect(res.text).toContain(`"'=HYPERLINK(""x"")"`)
    expect(res.text).toContain('+919811111111')
  })

  it('a walk-in admission creates the contact from the phone number', async () => {
    const staff = await t.login(t.users.staff)
    const rscit = await courseOf(t.orgA.org.id, 'RS-CIT')
    const res = await staff.post('/api/v1/students').send({
      name: 'Seema Jat',
      phone: '98290 12345',
      courseId: rscit.id,
      guardianPhone: '+91 98290 54321',
    })
    expect(res.status).toBe(201)
    const detail = await staff.get(`/api/v1/students/${res.body.student.id}`)
    expect(detail.body.contact.waId).toBe('919829012345')
    expect(detail.body.guardian.waId).toBe('919829054321')
    expect(detail.body.installments[0]).toMatchObject({ amountPaise: 4_500_00, status: 'due' })
  })
})

describe('fees and payments', () => {
  const openFee = async () => {
    const [row] = await t.db
      .select({ id: feeInstallments.id })
      .from(feeInstallments)
      .innerJoin(students, eq(students.id, feeInstallments.studentId))
      .where(
        and(
          eq(feeInstallments.orgId, t.orgA.org.id),
          eq(students.contactId, t.orgA.contact.id),
          eq(feeInstallments.status, 'upcoming'),
        ),
      )
      .limit(1)
    return row!.id
  }

  it('lists fees with the month summary', async () => {
    const owner = await t.login(t.users.owner)
    const res = await owner.get('/api/v1/fees?status=all')
    expect(res.body.fees.length).toBeGreaterThan(0)
    expect(res.body.summary).toEqual({
      dueThisMonthPaise: expect.any(Number),
      collectedThisMonthPaise: expect.any(Number),
      overduePaise: expect.any(Number),
    })
  })

  it('asks for Razorpay before making a link, and checks the keys before saving them', async () => {
    const owner = await t.login(t.users.owner)
    const id = await openFee()
    const noAccount = await owner.post(`/api/v1/fees/${id}/link`).send({ send: false })
    expect(noAccount.status).toBe(400)
    expect(noAccount.body.error.message).toContain('Connect Razorpay')

    const bad = await owner
      .put('/api/v1/org/payments')
      .send({ keyId: 'rzp_test_abc', keySecret: 'wrong-secret-123', webhookSecret: 'whsec-123' })
    expect(bad.status).toBe(400)
    const staff = await t.login(t.users.staff)
    expect(
      (
        await staff.put('/api/v1/org/payments').send({
          keyId: 'rzp_test_abc',
          keySecret: 'right-secret-123',
          webhookSecret: 'whsec-123',
        })
      ).status,
    ).toBe(403)
    const ok = await owner
      .put('/api/v1/org/payments')
      .send({ keyId: 'rzp_test_abc', keySecret: 'right-secret-123', webhookSecret: 'whsec-123' })
    expect(ok.status).toBe(200)
    const info = await owner.get('/api/v1/org/payments')
    expect(info.body).toMatchObject({ connected: true, keyId: 'rzp_test_abc' })
    expect(info.body.webhookUrl).toBe(
      `http://localhost:4000/webhooks/razorpay/org/${t.orgA.org.id}`,
    )
  })

  it('sends the link on WhatsApp, and Razorpay saying "paid" marks it paid with one receipt', async () => {
    const owner = await t.login(t.users.owner)
    const id = await openFee()
    t.rec.outbound.length = 0
    const sent = await owner.post(`/api/v1/fees/${id}/link`).send({})
    expect(sent.body).toMatchObject({
      sent: true,
      link: expect.stringContaining('https://rzp.io/i/'),
    })
    const [msg] = await t.db
      .select()
      .from(messages)
      .where(eq(messages.id, t.rec.outbound[0]!.messageId))
    expect(msg!.body).toContain(sent.body.link)
    const [inst] = await t.db.select().from(feeInstallments).where(eq(feeInstallments.id, id))

    const payload = JSON.stringify({
      event: 'payment_link.paid',
      payload: {
        payment_link: {
          entity: { id: inst!.paymentLinkId, reference_id: id, amount_paid: inst!.amountPaise },
        },
        payment: { entity: { id: 'pay_1', amount: inst!.amountPaise, created_at: 1792569600 } },
      },
    })
    const sign = (secret: string) => createHmac('sha256', secret).update(payload).digest('hex')
    const hook = () =>
      request(t.app)
        .post(`/webhooks/razorpay/org/${t.orgA.org.id}`)
        .set('content-type', 'application/json')
        .set('x-razorpay-signature', sign('whsec-123'))
        .send(payload)

    expect(
      (
        await request(t.app)
          .post(`/webhooks/razorpay/org/${t.orgA.org.id}`)
          .set('content-type', 'application/json')
          .set('x-razorpay-signature', sign('forged'))
          .send(payload)
      ).status,
    ).toBe(401)

    t.rec.outbound.length = 0
    expect((await hook()).status).toBe(200)
    expect((await hook()).status).toBe(200) // Razorpay retries: still one receipt
    const [paid] = await t.db.select().from(feeInstallments).where(eq(feeInstallments.id, id))
    expect(paid).toMatchObject({
      status: 'paid',
      paidVia: 'razorpay',
      receiptNo: expect.stringMatching(/^R-\d{4}$/),
    })
    expect(t.rec.outbound).toHaveLength(1)
    const [receipt] = await t.db
      .select()
      .from(messages)
      .where(eq(messages.id, t.rec.outbound[0]!.messageId))
    expect(receipt!.body).toBe(`₹6,000 mil gaye, dhanyavaad! Receipt no. ${paid!.receiptNo}.`)
  })

  it('"Cash mila" records the payment and sends the receipt; paying twice is refused', async () => {
    const owner = await t.login(t.users.owner)
    const id = await openFee()
    const res = await owner.post(`/api/v1/fees/${id}/mark-paid`).send({ via: 'cash' })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'paid', paidVia: 'cash' })
    expect((await owner.post(`/api/v1/fees/${id}/mark-paid`).send({ via: 'cash' })).status).toBe(
      400,
    )
  })

  it('the bulk overdue reminder can be estimated before it is sent', async () => {
    const owner = await t.login(t.users.owner)
    const res = await owner.post('/api/v1/fees/remind-overdue').send({ dryRun: true })
    expect(res.body).toEqual({
      count: expect.any(Number),
      needsTemplate: expect.any(Number),
      inWindow: expect.any(Number),
    })
  })
})

describe('Home: aaj ka hisaab', () => {
  it('counts the day and lists what needs doing', async () => {
    const owner = await t.login(t.users.owner)
    const res = await owner.get('/api/v1/analytics/summary?range=today')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      range: 'today',
      enquiries: expect.any(Number),
      admissions: expect.any(Number),
      feesCollectedPaise: expect.any(Number),
      waitingChats: expect.any(Number),
      demos: expect.any(Array),
      feesDue: expect.any(Array),
    })
    expect(res.body.admissions).toBeGreaterThanOrEqual(2)
    // The cash payment today; the Razorpay one is dated by Razorpay's own timestamp.
    expect(res.body.feesCollectedPaise).toBeGreaterThanOrEqual(6_000_00)
  })
})

describe('org settings', () => {
  it('owners edit the institute details; phone numbers are digits with a country code', async () => {
    const owner = await t.login(t.users.owner)
    expect((await owner.patch('/api/v1/org').send({ phone: '+91 98290 00000' })).status).toBe(400)
    const ok = await owner
      .patch('/api/v1/org')
      .send({ phone: '919829000000', latitude: 27.61, longitude: 75.14 })
    expect(ok.body).toMatchObject({ phone: '919829000000', latitude: 27.61 })
    const staff = await t.login(t.users.staff)
    expect((await staff.patch('/api/v1/org').send({ city: 'Jaipur' })).status).toBe(403)
    expect((await staff.get('/api/v1/org')).body.name).toBe('Shiksha Computer Institute')
  })
})

describe('tenant isolation for the coaching screens', () => {
  it("org A can't see or change org B's courses, leads, demos, students or fees", async () => {
    const b = t.orgB
    const leadB = await ensureLead(t.db, { orgId: b.org.id, contactId: b.contact.id, actor: 'bot' })
    const courseB = await courseOf(b.org.id, 'RS-CIT')
    const [batchB] = await t.db.select().from(batches).where(eq(batches.courseId, courseB.id))
    const ownerB = await t.login(t.users.secondOwner)
    const admitted = await ownerB
      .post(`/api/v1/leads/${leadB!.id}/admit`)
      .send({ name: 'B Student', courseId: courseB.id })
    const studentB = admitted.body.student.id as string
    const feeB = admitted.body.installments[0].id as string
    const demoB = await ownerB.post('/api/v1/demos').send({
      leadId: leadB!.id,
      batchId: batchB!.id,
      date: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10),
      studentName: 'B Student',
      notify: false,
    })

    const owner = await t.login(t.users.owner)
    const attempts = [
      owner.get(`/api/v1/leads/${leadB!.id}`),
      owner.patch(`/api/v1/leads/${leadB!.id}`).send({ notes: 'x' }),
      owner.post(`/api/v1/leads/${leadB!.id}/stage`).send({ stage: 'contacted' }),
      owner.post(`/api/v1/leads/${leadB!.id}/admit`).send({ name: 'x', courseId: courseB.id }),
      owner.patch(`/api/v1/courses/${courseB.id}`).send({ feeTotalPaise: 1 }),
      owner.patch(`/api/v1/batches/${batchB!.id}`).send({ seatsTotal: 1 }),
      owner.patch(`/api/v1/demos/${demoB.body.id}`).send({ status: 'no_show' }),
      owner
        .post('/api/v1/demos')
        .send({ leadId: leadB!.id, batchId: batchB!.id, date: '2030-01-01', studentName: 'x' }),
      owner.get(`/api/v1/students/${studentB}`),
      owner.patch(`/api/v1/students/${studentB}`).send({ name: 'x' }),
      owner.post(`/api/v1/fees/${feeB}/mark-paid`).send({ via: 'cash' }),
      owner.post(`/api/v1/fees/${feeB}/remind`),
      owner.post(`/api/v1/fees/${feeB}/waive`),
    ]
    const results = await Promise.all(attempts)
    results.forEach((res, i) => expect(res.status, `attempt ${i + 1}`).toBe(404))

    const lists = await Promise.all([
      owner.get('/api/v1/leads'),
      owner.get('/api/v1/students'),
      owner.get('/api/v1/fees?status=all'),
      owner.get('/api/v1/courses'),
    ])
    expect(lists[0]!.body.leads.some((l: { id: string }) => l.id === leadB!.id)).toBe(false)
    expect(lists[1]!.body.students.some((s: { id: string }) => s.id === studentB)).toBe(false)
    expect(lists[2]!.body.fees.some((f: { id: string }) => f.id === feeB)).toBe(false)
    expect(lists[3]!.body.courses.some((c: { id: string }) => c.id === courseB.id)).toBe(false)
    const [fee] = await t.db.select().from(feeInstallments).where(eq(feeInstallments.id, feeB))
    expect(fee!.status).not.toBe('paid')
    const [lead] = await t.db.select().from(leads).where(eq(leads.id, leadB!.id))
    expect(lead!.notes).toBeNull()
  })

  it("a Razorpay webhook for org A can't pay org B's installment", async () => {
    const [feeB] = await t.db
      .select()
      .from(feeInstallments)
      .where(eq(feeInstallments.orgId, t.orgB.org.id))
      .limit(1)
    await t.db
      .update(feeInstallments)
      .set({ paymentLinkId: 'plink_b' })
      .where(eq(feeInstallments.id, feeB!.id))
    const payload = JSON.stringify({
      event: 'payment_link.paid',
      payload: {
        payment_link: { entity: { id: 'plink_b' } },
        payment: { entity: { id: 'pay_b', amount: 100 } },
      },
    })
    const res = await request(t.app)
      .post(`/webhooks/razorpay/org/${t.orgA.org.id}`)
      .set('content-type', 'application/json')
      .set('x-razorpay-signature', createHmac('sha256', 'whsec-123').update(payload).digest('hex'))
      .send(payload)
    expect(res.body).toEqual({ ok: true, ignored: true })
    const [after] = await t.db
      .select()
      .from(feeInstallments)
      .where(eq(feeInstallments.id, feeB!.id))
    expect(after!.status).not.toBe('paid')
  })
})
