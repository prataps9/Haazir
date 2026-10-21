import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { contacts, courses, organizations, students, type AnyDatabase } from '@haazir/db'
import { seed } from '@haazir/db/seed'
import { createTestDb } from '@haazir/db/testing'
import { formatDays, formatTime } from '../facts'
import { createToolContext, loadFlowContext } from '../pipeline'
import { createTools, matchCourse, type ToolContext } from '../tools'

let db: AnyDatabase
let close: () => Promise<void>
let orgId: string

beforeAll(async () => {
  ;({ db, close } = await createTestDb())
  orgId = (await seed(db, { crm: true })).org.id
})
afterAll(() => close())

const ctxFor = async (
  org = orgId,
  options: { contactId?: string; paymentsEnabled?: boolean } = {},
): Promise<ToolContext> => {
  const [row] = await db.select().from(organizations).where(eq(organizations.id, org))
  const flow = await loadFlowContext(db, row!, new Date(), 'hinglish', null)
  const ctx = await createToolContext(db, row!, {
    contactId: options.contactId ?? '00000000-0000-0000-0000-000000000000',
    flow,
  })
  if (options.paymentsEnabled) ctx.org.paymentsEnabled = true
  return ctx
}

// Tools run through the SDK in production; here we call execute directly.
const run = async (ctx: ToolContext, name: keyof ReturnType<typeof createTools>, input: object) =>
  (createTools(ctx)[name].execute as (i: object, o: object) => Promise<unknown>)(input, {
    toolCallId: 't',
    messages: [],
  })

describe('matchCourse', () => {
  it.each([
    ['rscit', 'RS-CIT'],
    ['RS CIT course', 'RS-CIT'],
    ['rs-cit', 'RS-CIT'],
    ['tally', 'Tally Prime + GST'],
    ['Tally GST', 'Tally Prime + GST'],
    ['pyton', 'Python + AI'],
    ['web dev', 'Web Development'],
  ])('%s → %s', async (query, expected) => {
    const list = await db.select().from(courses)
    expect(matchCourse(list, query)?.shortName).toBe(expected)
  })

  it('returns null rather than guessing', async () => {
    const list = await db.select().from(courses)
    expect(matchCourse(list, 'nursing')).toBeNull()
  })
})

describe('tools', () => {
  it('get_course_details returns the fee from the database, formatted, and records it as a fact', async () => {
    const ctx = await ctxFor()
    const out = (await run(ctx, 'get_course_details', { course: 'tally' })) as Record<
      string,
      unknown
    >
    expect(out.total_fee).toBe('₹8,500')
    expect(out.installments).toEqual([
      { label: 'Pehli kisht', amount: '₹4,500', due: 'at admission' },
      { label: 'Doosri kisht', amount: '₹4,000', due: '30 days after admission' },
    ])
    expect(ctx.facts[0]).toContain('₹8,500')
  })

  it('get_batches lists upcoming batches with seats left', async () => {
    const out = (await run(await ctxFor(), 'get_batches', { course: 'rscit' })) as {
      batches: { seats_left: number; time: string }[]
    }
    expect(out.batches).toHaveLength(2)
    expect(out.batches[0]).toMatchObject({ seats_left: 8, time: '8:00 AM to 9:30 AM' })
  })

  it('check_demo_slots offers real dates over the next week, never batches without demos', async () => {
    const out = (await run(await ctxFor(), 'check_demo_slots', { course: 'tally' })) as {
      demo_slots: { batch: string; date: string; batch_id: string }[]
    }
    expect(out.demo_slots.length).toBeGreaterThan(0)
    expect(new Set(out.demo_slots.map((s) => s.batch))).toEqual(new Set(['Tally Subah']))
  })

  it('book_demo books only a slot check_demo_slots would offer, as an action for the worker', async () => {
    const ctx = await ctxFor()
    const slots = (await run(ctx, 'check_demo_slots', { course: 'rscit' })) as {
      demo_slots: { batch_id: string; date: string }[]
    }
    const slot = slots.demo_slots[0]!
    const bad = await run(ctx, 'book_demo', {
      batch_id: slot.batch_id,
      date: '2020-01-01',
      student_name: 'Anil',
    })
    expect(bad).toMatchObject({ booked: false })
    expect(ctx.actions).toEqual([])

    const good = await run(ctx, 'book_demo', { ...slot, student_name: 'anil kumar' })
    expect(good).toMatchObject({ booked: true, course: 'RS-CIT', student: 'Anil Kumar' })
    expect(ctx.actions).toEqual([
      expect.objectContaining({
        type: 'book_demo',
        batchId: slot.batch_id,
        date: slot.date,
        studentName: 'Anil Kumar',
      }),
    ])
  })

  it("send_brochure says so when there's no brochure, instead of promising one", async () => {
    const ctx = await ctxFor()
    expect(await run(ctx, 'send_brochure', { course: 'rscit' })).toMatchObject({ sent: false })
    expect(ctx.actions).toEqual([])
  })

  it('send_location shares the address and sends the pin when the org has one', async () => {
    const ctx = await ctxFor()
    expect(await run(ctx, 'send_location', {})).toMatchObject({
      address: expect.stringContaining('Sikar'),
      pin_sent: true,
    })
    expect(ctx.actions).toEqual([{ type: 'send_location' }])
  })

  it("get_my_fee_status shows a student's next installment, and queues a link when payments are on", async () => {
    const [student] = await db.select().from(students).where(eq(students.orgId, orgId)).limit(1)
    const ctx = await ctxFor(orgId, { contactId: student!.contactId, paymentsEnabled: true })
    const out = (await run(ctx, 'get_my_fee_status', {})) as Record<string, unknown>
    if (out.all_paid) return // that student happens to have paid everything
    expect(out).toMatchObject({ student: student!.name, amount: expect.stringMatching(/^₹/) })
    expect(ctx.actions[0]).toMatchObject({ type: 'send_payment_link' })

    const [stranger] = await db.insert(contacts).values({ orgId, waId: '911000008888' }).returning()
    const notStudent = await run(
      await ctxFor(orgId, { contactId: stranger!.id }),
      'get_my_fee_status',
      {},
    )
    expect(notStudent).toMatchObject({ student: false })
  })

  it('upsert_lead records what the bot learned, matched to a real course', async () => {
    const ctx = await ctxFor()
    await run(ctx, 'upsert_lead', {
      course: 'tally',
      name: 'priya kumawat',
      notes: 'Evening batch chahiye',
    })
    expect(ctx.actions[0]).toMatchObject({
      type: 'upsert_lead',
      studentName: 'Priya Kumawat',
      notes: 'Evening batch chahiye',
    })
    expect((ctx.actions[0] as { courseId?: string }).courseId).toBeTruthy()
  })

  it('an unknown course comes back as short text with the real options', async () => {
    const out = await run(await ctxFor(), 'get_course_details', { course: 'nursing' })
    expect(out).toMatchObject({ error: 'No course matches "nursing".' })
    expect((out as { available_courses: string[] }).available_courses).toContain('RS-CIT')
  })

  it("only ever reads the current org's data", async () => {
    const [other] = await db
      .insert(organizations)
      .values({ name: 'Other', slug: 'other-org' })
      .returning()
    const out = (await run(await ctxFor(other!.id), 'get_courses', {})) as { courses: unknown[] }
    expect(out.courses).toEqual([])
  })

  it('handoff_to_human sets the flag the pipeline acts on', async () => {
    const ctx = await ctxFor()
    await run(ctx, 'handoff_to_human', { reason: 'missing_info', summary: 'Hostel ke baare mein' })
    expect(ctx.handoff).toEqual({ reason: 'missing_info', summary: 'Hostel ke baare mein' })
  })
})

describe('formatting', () => {
  it('writes days and times the way people read them', () => {
    expect(formatDays(['mon', 'tue', 'wed', 'thu', 'fri', 'sat'])).toBe('Mon–Sat')
    expect(formatDays(['fri', 'mon', 'wed'])).toBe('Mon, Wed, Fri')
    expect(formatTime('17:00:00')).toBe('5:00 PM')
    expect(formatTime('00:30')).toBe('12:30 AM')
  })
})
