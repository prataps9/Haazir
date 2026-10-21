import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { batches, botConfigs, conversations, courses, demoBookings, leads } from '@haazir/db'
import { markBotReplied } from '../effects'
import { dayLabel, parseDay, weekdayOf } from '../flows/calendar'
import { cleanName, continueDemo, parseSlot, startDemo, type FlowContext } from '../flows/demo'
import { decideReply, loadFlowContext, type Decision, type PipelineDeps } from '../pipeline'
import { createFixture, models, router, scripted } from './helpers'

const MONDAY_11AM_IST = new Date('2026-09-28T05:30:00Z')
const TODAY = '2026-09-28'

describe('calendar', () => {
  it('reads days the way people type them', () => {
    expect(parseDay('kal', TODAY)).toBe('2026-09-29')
    expect(parseDay('aaj shaam', TODAY)).toBe(TODAY)
    expect(parseDay('parso', TODAY)).toBe('2026-09-30')
    expect(parseDay('कल', TODAY)).toBe('2026-09-29')
    expect(parseDay('shanivar ko', TODAY)).toBe('2026-10-03')
    expect(parseDay('Saturday', TODAY)).toBe('2026-10-03')
    expect(parseDay('2 oct', TODAY)).toBe('2026-10-02')
    expect(parseDay('30', TODAY)).toBe('2026-09-30')
    expect(parseDay('5', TODAY)).toBe('2026-10-05') // the 5th has passed this month
    expect(parseDay('5 baje', TODAY)).toBeNull()
    expect(parseDay('fees kitni hai', TODAY)).toBeNull()
  })

  it('labels days in the reply language within a list row', () => {
    expect(weekdayOf(TODAY)).toBe('mon')
    expect(dayLabel('2026-09-29', TODAY, 'hinglish')).toBe('Kal (Mangalvar)')
    expect(dayLabel('2026-09-30', TODAY, 'hi')).toBe('परसों (बुधवार)')
    expect(dayLabel('2026-10-02', TODAY, 'en')).toBe('Friday, 2 Oct')
    for (const lang of ['hi', 'hinglish', 'en'] as const)
      for (let i = 0; i < 7; i++)
        expect([...dayLabel(`2026-10-0${i + 1}`, TODAY, lang)].length).toBeLessThanOrEqual(24)
  })

  it('takes a name out of a sentence, and refuses things that are not names', () => {
    expect(cleanName('Mera naam anil kumar hai')).toBe('Anil Kumar')
    expect(cleanName('Priya')).toBe('Priya')
    expect(cleanName('राहुल शर्मा')).toBe('राहुल शर्मा')
    expect(cleanName('fees kitni hai?')).toBeNull()
    expect(cleanName('haan')).toBeNull()
    expect(cleanName('call me at 9876543210')).toBeNull()
  })
})

describe('demo flow (pure)', () => {
  let f: Awaited<ReturnType<typeof createFixture>>
  let ctx: FlowContext
  beforeEach(async () => {
    f = await createFixture()
    ctx = await loadFlowContext(f.db, f.org, MONDAY_11AM_IST, 'hinglish', 'Anil')
  })
  afterEach(() => f.close())

  const rscit = () => ctx.courses.find((c) => c.shortName === 'RS-CIT')!

  it('asks for the course, then the day, then the time, then the name, then confirms', () => {
    const s1 = startDemo(ctx)
    expect(s1.state?.step).toBe('course')
    expect(s1.content.kind).toBe('list')

    const s2 = continueDemo(s1.state!, { id: `demo_course:${rscit().id}`, text: 'RS-CIT' }, ctx)!
    expect(s2.state).toMatchObject({ step: 'day', courseId: rscit().id })
    // Today still has the 5 PM batch; the 8 AM one has gone.
    const rows = s2.content.kind === 'list' ? s2.content.sections[0]!.rows : []
    expect(rows[0]).toEqual({ id: `demo_day:${TODAY}`, title: 'Aaj (Somvar)' })

    const s3 = continueDemo(s2.state!, { text: 'kal' }, ctx)!
    expect(s3.state).toMatchObject({ step: 'slot', date: '2026-09-29' })

    const s4 = continueDemo(s3.state!, { text: 'shaam wala' }, ctx)!
    expect(s4.state?.step).toBe('name')
    expect(s4.content).toMatchObject({
      kind: 'buttons',
      buttons: [{ id: 'demo_name', title: 'Anil' }],
    })

    const s5 = continueDemo(s4.state!, { text: 'mera naam Ravi Meena hai' }, ctx)!
    expect(s5.state).toMatchObject({ step: 'confirm', studentName: 'Ravi Meena' })
    expect(s5.content.body).toContain('Ravi Meena')
    expect(s5.content.body).toContain('5:00 PM')

    const done = continueDemo(s5.state!, { id: 'demo_yes', text: 'Haan, book karo' }, ctx)!
    expect(done.state).toBeNull()
    expect(done.actions).toEqual([
      expect.objectContaining({
        type: 'book_demo',
        courseId: rscit().id,
        date: '2026-09-29',
        studentName: 'Ravi Meena',
      }),
    ])
    expect(done.content.body).toContain('Station Road')
  })

  it('skips questions with one answer, and fills in what the person already said', () => {
    const python = ctx.courses.find((c) => c.shortName === 'Python + AI')!
    // Python runs Mon/Wed/Fri at 2 PM: one slot a day, so no time question.
    const r = startDemo(ctx, { courseId: python.id, date: '2026-09-30', studentName: 'Komal' })
    expect(r.state).toMatchObject({ step: 'confirm', batchId: expect.any(String) })
  })

  it("won't book a day without a class, and says why", () => {
    const python = ctx.courses.find((c) => c.shortName === 'Python + AI')!
    const r = startDemo(ctx, { courseId: python.id })
    const next = continueDemo(r.state!, { text: 'kal' }, ctx)! // Tuesday: no Python class
    expect(next.state?.step).toBe('day')
    expect(next.content.body).toContain('Us din demo class nahi hai')
  })

  it('returns null for an aside, so the pipeline can answer it', () => {
    const s = startDemo(ctx)
    expect(continueDemo(s.state!, { text: 'fees kitni hai?' }, ctx)).toBeNull()
  })

  it('can be cancelled at any step', () => {
    const s = startDemo(ctx)
    const r = continueDemo(s.state!, { text: 'rehne do' }, ctx)!
    expect(r.state).toBeNull()
    expect(r.content.body).toContain('rok di')
  })

  it('hands over when no course has a demo slot this week', async () => {
    await f.db.update(batches).set({ demoAllowed: false })
    const empty = await loadFlowContext(f.db, f.org, MONDAY_11AM_IST, 'hinglish', null)
    const r = startDemo(empty)
    expect(r.state).toBeNull()
    expect(r.handoff?.reason).toBe('missing_info')
  })

  it('reads times as people say them', () => {
    const slots = ctx.batches.filter((b) => b.courseId === rscit().id)
    expect(parseSlot('subah', slots)?.name).toBe('RS-CIT Subah')
    expect(parseSlot('5 baje', slots)?.name).toBe('RS-CIT Shaam')
    expect(parseSlot('8 am', slots)?.name).toBe('RS-CIT Subah')
    expect(parseSlot('koi bhi', slots)).toBeNull()
  })
})

describe('the bot without AI (rules only)', () => {
  let f: Awaited<ReturnType<typeof createFixture>>
  const deps = (m: PipelineDeps['models'] = null): PipelineDeps => ({
    db: f.db,
    models: m,
    now: () => MONDAY_11AM_IST,
  })
  beforeEach(async () => {
    f = await createFixture()
  })
  afterEach(() => f.close())

  /** One message in and the decision applied, as the worker does. */
  const say = async (
    text: string,
    tap?: { id: string; title: string },
    m: PipelineDeps['models'] = null,
  ) => {
    const turn = await f.inbound(
      tap ? tap.title : text,
      tap ? { type: 'interactive', interactive: { kind: 'list_reply', ...tap } } : {},
    )
    const d = await decideReply(deps(m), turn)
    if (d.kind === 'reply')
      await markBotReplied(f.db, f.conversation.id, MONDAY_11AM_IST, d.flowState)
    return d
  }
  const rowsOf = (d: Decision) =>
    'content' in d && d.content.kind === 'list' ? d.content.sections.flatMap((s) => s.rows) : []

  it('greets with the menu, lists courses, and shows a course straight from the database', async () => {
    const hello = await say('Namaste')
    expect(hello).toMatchObject({ kind: 'reply', content: { kind: 'buttons' } })

    const list = await say('', { id: 'menu_courses', title: 'Courses dekhein' })
    const rows = rowsOf(list)
    expect(rows.map((r) => r.title)).toEqual([
      'RS-CIT',
      'Tally Prime + GST',
      'Web Development',
      'Python + AI',
    ])
    expect(rows[0]!.description).toContain('₹4,500')

    const tally = rows[1]!
    const card = await say('', tally)
    expect(card.kind).toBe('reply')
    expect('content' in card && card.content.body).toContain('₹8,500')
    expect('content' in card && card.content.body).toContain('Doosri kisht: ₹4,000')
    expect(card.kind === 'reply' && card.actions).toEqual([
      { type: 'upsert_lead', courseId: tally.id.slice('course:'.length) },
    ])
  })

  it('books a demo end to end by taps, without any AI', async () => {
    const start = await say('', { id: 'menu_demo', title: 'Free demo' })
    const course = rowsOf(start).find((r) => r.title === 'RS-CIT')!
    const days = await say('', course)
    const tomorrow = rowsOf(days).find((r) => r.id === 'demo_day:2026-09-29')!
    const times = await say('', tomorrow)
    const morning = rowsOf(times).find((r) => r.title.startsWith('8:00 AM'))!
    const name = await say('', morning)
    expect(name).toMatchObject({ content: { buttons: [{ id: 'demo_name', title: 'Anil' }] } })
    const confirm = await say('Anil', { id: 'demo_name', title: 'Anil' })
    expect('content' in confirm && confirm.content.body).toContain('Anil')
    const booked = await say('', { id: 'demo_yes', title: 'Haan, book karo' })
    expect(booked.kind).toBe('reply')
    expect(booked.kind === 'reply' && booked.actions[0]).toMatchObject({
      type: 'book_demo',
      date: '2026-09-29',
      studentName: 'Anil',
    })
    expect('content' in booked && booked.content.body).toContain('Station Road')
    // The flow is over: the next message starts fresh.
    const [conv] = await f.db
      .select()
      .from(conversations)
      .where(eq(conversations.id, f.conversation.id))
    expect((conv!.flowState as { demo?: unknown }).demo).toBeUndefined()
  })

  it('typing "demo" starts the booking, with the course they named', async () => {
    const d = await say('RS-CIT ki demo kal chahiye')
    expect(d.kind === 'reply' && d.flowState?.demo).toMatchObject({
      courseId: expect.any(String),
      date: '2026-09-29',
      step: 'slot',
    })
  })

  it('asks again once when a message mid-booking makes no sense, then hands over', async () => {
    await say('', { id: 'menu_demo', title: 'Free demo' })
    const again = await say('hostel hai kya')
    expect(again).toMatchObject({ kind: 'reply', content: { kind: 'list' } })
    expect('content' in again && again.content.body).toContain('Neeche diye vikalp')
    const handed = await say('batao na')
    expect(handed).toMatchObject({ kind: 'handoff', reason: 'low_confidence' })
  })

  it('a course name alone gets the course card; anything else goes to the team', async () => {
    expect(await say('tally')).toMatchObject({ kind: 'reply', content: { kind: 'buttons' } })
    expect(await say('Hostel ki suvidha hai?')).toMatchObject({
      kind: 'handoff',
      reason: 'ai_unavailable',
    })
  })

  it('answers the demo reminder buttons', async () => {
    const [rscit] = await f.db.select().from(courses).where(eq(courses.shortName, 'RS-CIT'))
    const [lead] = await f.db
      .insert(leads)
      .values({ orgId: f.org.id, contactId: f.contact.id })
      .returning()
    const [booking] = await f.db
      .insert(demoBookings)
      .values({
        orgId: f.org.id,
        leadId: lead!.id,
        contactId: f.contact.id,
        courseId: rscit!.id,
        studentName: 'Anil',
        startsAt: new Date('2026-09-28T11:30:00Z'),
      })
      .returning()
    const yes = await say('', { id: `demo_yes:${booking!.id}`, title: 'Haan, aa raha hoon' })
    expect(yes.kind === 'reply' && yes.actions).toEqual([
      { type: 'demo_answer', bookingId: booking!.id, answer: 'coming' },
    ])
    const change = await say('', { id: `demo_reschedule:${booking!.id}`, title: 'Time badlo' })
    expect(change.kind === 'reply' && change.actions[0]).toEqual({
      type: 'demo_answer',
      bookingId: booking!.id,
      answer: 'reschedule',
    })
    expect(change.kind === 'reply' && change.flowState?.demo).toMatchObject({
      courseId: rscit!.id,
      step: 'day',
    })
  })

  it('the bot switched off still means off, even for taps', async () => {
    await f.db.update(botConfigs).set({ enabled: false })
    expect(await say('', { id: 'menu_demo', title: 'Free demo' })).toMatchObject({
      kind: 'handoff',
      reason: 'bot_disabled',
    })
  })

  it('with AI, an aside mid-booking is answered and the booking offered again', async () => {
    await say('', { id: 'menu_demo', title: 'Free demo' })
    const m = models(
      router({
        intent: 'fee_query',
        language: 'hinglish',
        script: 'latin',
        entities: { course: 'rscit' },
      }),
      scripted({ text: 'Hostel ki jaankari team degi.' }),
    )
    const d = await say('aur hostel?', undefined, m)
    expect(d).toMatchObject({
      kind: 'reply',
      content: { kind: 'buttons', buttons: [{ id: 'demo_continue' }, { id: 'demo_cancel' }] },
    })
    expect(d.kind === 'reply' && d.flowState?.demo?.step).toBe('course')
  })
})
