import type { batches, courses } from '@haazir/db'
import { addDays, defaultTemplate, fillTemplate } from '@haazir/shared'
import type { AgentAction } from '../actions'
import { formatTime } from '../facts'
import type { ReplyLanguage } from '../language'
import type { ReplyContent } from '../pipeline'
import { matchCourse } from '../match'
import { dayLabel, longDayLabel, parseDay, weekdayOf } from './calendar'
import { BUTTON, fill, FLOW } from './copy'

type Course = typeof courses.$inferSelect
type Batch = typeof batches.$inferSelect

/**
 * Demo booking (spec §11.5): course → day → time → student name → confirm →
 * book. A state machine in code, not the LLM: it can't invent a slot, and it
 * works with no AI key at all. Owners change the words, not the steps.
 */
export interface DemoState {
  step: 'course' | 'day' | 'slot' | 'name' | 'confirm'
  courseId?: string
  date?: string
  batchId?: string
  studentName?: string
  /** Messages in a row that didn't answer the step (no AI to answer them). */
  misses?: number
  /** When the flow started; an old flow is dropped instead of resumed. */
  at: string
}

export interface FlowContext {
  courses: Course[]
  batches: Batch[]
  /** Today and the time now, in IST. */
  today: string
  nowTime: string
  now: Date
  lang: ReplyLanguage
  orgName: string
  address: string | null
  /** The name we already know (contact or lead), offered as a one-tap answer. */
  knownName: string | null
}

export interface FlowInput {
  /** Button or list row id, when the person tapped one. */
  id?: string
  title?: string
  text: string
}

export interface FlowResult {
  content: ReplyContent
  state: DemoState | null
  actions?: AgentAction[]
  handoff?: { reason: 'missing_info'; summary: string }
}

export const DEMO_FLOW_TTL_MS = 24 * 60 * 60 * 1000
const DAYS_AHEAD = 7

const minutes = (hhmm: string) => {
  const [h = 0, m = 0] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** Batches of the course that run a demo on that date, with a seat, at least an hour from now. */
export function slotsOn(ctx: FlowContext, courseId: string, date: string): Batch[] {
  // Today to a month ahead; anything else (a past date, a typo'd year) has no slots.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < ctx.today || date > addDays(ctx.today, 30))
    return []
  const day = weekdayOf(date)
  return ctx.batches
    .filter(
      (b) =>
        b.courseId === courseId &&
        b.active &&
        b.demoAllowed &&
        b.seatsFilled < b.seatsTotal &&
        b.days.includes(day) &&
        (date !== ctx.today || minutes(b.startTime) >= minutes(ctx.nowTime) + 60),
    )
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
}

export function daysWithSlots(ctx: FlowContext, courseId: string): string[] {
  return Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(ctx.today, i)).filter(
    (d) => slotsOn(ctx, courseId, d).length > 0,
  )
}

const bookable = (ctx: FlowContext) =>
  ctx.courses.filter((c) => c.active && daysWithSlots(ctx, c.id).length > 0)

const courseOf = (ctx: FlowContext, id?: string) => ctx.courses.find((c) => c.id === id)

/** What to ask for this step. */
function prompt(state: DemoState, ctx: FlowContext, note?: string): ReplyContent {
  const { lang } = ctx
  const lead = note ? `${note}\n\n` : ''
  const course = courseOf(ctx, state.courseId)
  switch (state.step) {
    case 'course':
      return {
        kind: 'list',
        body: lead + FLOW.pickCourse[lang],
        buttonLabel: BUTTON.pickCourse[lang],
        sections: [
          {
            rows: bookable(ctx)
              .slice(0, 10)
              .map((c) => ({ id: `demo_course:${c.id}`, title: c.shortName.slice(0, 24) })),
          },
        ],
      }
    case 'day':
      return {
        kind: 'list',
        body: lead + fill(FLOW.pickDay[lang], { course: course?.shortName ?? '' }),
        buttonLabel: BUTTON.pickDay[lang],
        sections: [
          {
            rows: daysWithSlots(ctx, state.courseId!).map((d) => ({
              id: `demo_day:${d}`,
              title: dayLabel(d, ctx.today, lang),
            })),
          },
        ],
      }
    case 'slot':
      return {
        kind: 'list',
        body: lead + fill(FLOW.pickSlot[lang], { day: dayLabel(state.date!, ctx.today, lang) }),
        buttonLabel: BUTTON.pickTime[lang],
        sections: [
          {
            rows: slotsOn(ctx, state.courseId!, state.date!).map((b) => ({
              id: `demo_slot:${b.id}`,
              title: `${formatTime(b.startTime)}–${formatTime(b.endTime)}`.slice(0, 24),
              description: b.name.slice(0, 72),
            })),
          },
        ],
      }
    case 'name':
      return ctx.knownName
        ? {
            kind: 'buttons',
            body: lead + FLOW.askName[lang],
            buttons: [{ id: 'demo_name', title: ctx.knownName.slice(0, 20) }],
          }
        : { kind: 'text', body: lead + FLOW.askName[lang] }
    case 'confirm': {
      const batch = ctx.batches.find((b) => b.id === state.batchId)
      return {
        kind: 'buttons',
        body:
          lead +
          fill(FLOW.confirm[lang], {
            course: course?.shortName ?? '',
            when: `${longDayLabel(state.date!, ctx.today, lang)}, ${formatTime(batch!.startTime)}`,
            name: state.studentName!,
          }),
        buttons: [
          { id: 'demo_yes', title: BUTTON.yesBook[lang] },
          { id: 'demo_change', title: BUTTON.change[lang] },
        ],
      }
    }
  }
}

/**
 * Fills in whatever needs no question (the only course, the only time that
 * day), drops answers that no longer hold, and asks for the first gap.
 */
function advance(state: DemoState, ctx: FlowContext, note?: string): FlowResult {
  const s: DemoState = { ...state, misses: 0 }
  const options = bookable(ctx)
  if (!options.length) {
    return {
      content: { kind: 'text', body: FLOW.noSlots[ctx.lang] },
      state: null,
      handoff: { reason: 'missing_info', summary: 'Demo chahiye, koi slot khaali nahi' },
    }
  }
  if (s.courseId && !options.some((c) => c.id === s.courseId)) {
    // Asked for a course with no demo this week: let the team arrange one.
    return {
      content: { kind: 'text', body: FLOW.noSlots[ctx.lang] },
      state: null,
      handoff: {
        reason: 'missing_info',
        summary: `${courseOf(ctx, s.courseId)?.shortName ?? 'Course'} ki demo chahiye, slot nahi`,
      },
    }
  }
  if (!s.courseId) {
    if (options.length === 1) s.courseId = options[0]!.id
    else
      return {
        content: prompt({ ...s, step: 'course' }, ctx, note),
        state: { ...s, step: 'course' },
      }
  }
  if (s.date && !slotsOn(ctx, s.courseId, s.date).length) {
    delete s.date
    note ??= FLOW.noSlotsThatDay[ctx.lang]
  }
  if (!s.date)
    return { content: prompt({ ...s, step: 'day' }, ctx, note), state: { ...s, step: 'day' } }
  const slots = slotsOn(ctx, s.courseId, s.date)
  if (s.batchId && !slots.some((b) => b.id === s.batchId)) delete s.batchId
  if (!s.batchId) {
    if (slots.length === 1) s.batchId = slots[0]!.id
    else
      return { content: prompt({ ...s, step: 'slot' }, ctx, note), state: { ...s, step: 'slot' } }
  }
  if (!s.studentName)
    return { content: prompt({ ...s, step: 'name' }, ctx, note), state: { ...s, step: 'name' } }
  return { content: prompt({ ...s, step: 'confirm' }, ctx, note), state: { ...s, step: 'confirm' } }
}

/** Starts the flow, using anything already known (the course they asked about, a day, a name). */
export function startDemo(
  ctx: FlowContext,
  prefill: { courseId?: string; date?: string; studentName?: string } = {},
): FlowResult {
  return advance({ step: 'course', ...prefill, at: ctx.now.toISOString() }, ctx)
}

// `\b` is ASCII-only in JS, so Devanagari words end at a space, punctuation or the end.
const END = '(?=[\\s.,!?]|$)'
const CANCEL = new RegExp(
  `^(cancel|stop booking|rehne do|rehne doo|rahne do|nahi chahiye|mat karo|रहने दो|नहीं चाहिए)${END}`,
  'u',
)
const YES = new RegExp(
  `^(ha+n?|haa+|yes|y|ok|okay|theek|thik|book|haan ji|ji|हाँ|हां|जी|ठीक)${END}`,
  'u',
)
const NO = new RegExp(`^(badlo|change|nahi|nahin|no|बदलें|बदलो|नहीं)${END}`, 'u')

/**
 * One answer in the flow. Returns null when the message isn't an answer to
 * this step ("fees kitni hai?" mid-booking): the pipeline answers it, then
 * offers to continue.
 */
export function continueDemo(
  state: DemoState,
  input: FlowInput,
  ctx: FlowContext,
): FlowResult | null {
  const text = input.text.trim().toLowerCase()
  if (input.id === 'demo_cancel' || (!input.id && CANCEL.test(text))) {
    return { content: { kind: 'text', body: FLOW.cancelled[ctx.lang] }, state: null }
  }
  if (input.id === 'demo_continue')
    return { content: prompt(state, ctx), state: { ...state, misses: 0 } }

  // A tap on any earlier step's list still counts: people scroll up and pick again.
  if (input.id?.startsWith('demo_course:')) {
    const courseId = input.id.slice('demo_course:'.length)
    return advance({ step: 'day', courseId, studentName: state.studentName, at: state.at }, ctx)
  }
  if (input.id?.startsWith('demo_day:')) {
    return advance({ ...state, date: input.id.slice('demo_day:'.length), batchId: undefined }, ctx)
  }
  if (input.id?.startsWith('demo_slot:')) {
    return advance({ ...state, batchId: input.id.slice('demo_slot:'.length) }, ctx)
  }

  switch (state.step) {
    case 'course': {
      const course = matchCourse(bookable(ctx), input.text)
      return course ? advance({ ...state, courseId: course.id }, ctx) : null
    }
    case 'day': {
      const date = parseDay(input.text, ctx.today)
      return date ? advance({ ...state, date, batchId: undefined }, ctx) : null
    }
    case 'slot': {
      const batch = parseSlot(input.text, slotsOn(ctx, state.courseId!, state.date!))
      return batch ? advance({ ...state, batchId: batch.id }, ctx) : null
    }
    case 'name': {
      const name = input.id === 'demo_name' ? (ctx.knownName ?? input.title) : cleanName(input.text)
      return name ? advance({ ...state, studentName: name }, ctx) : null
    }
    case 'confirm': {
      if (input.id === 'demo_yes' || (!input.id && YES.test(text))) return book(state, ctx)
      if (input.id === 'demo_change' || (!input.id && NO.test(text))) {
        return advance({ step: 'course', studentName: state.studentName, at: state.at }, ctx)
      }
      return null
    }
  }
}

/** The message that re-asks the current step after an off-topic answer. */
export function repromptDemo(state: DemoState, ctx: FlowContext, note?: string): ReplyContent {
  return prompt(state, ctx, note)
}

function book(state: DemoState, ctx: FlowContext): FlowResult {
  const course = courseOf(ctx, state.courseId)!
  const batch = ctx.batches.find((b) => b.id === state.batchId)!
  const confirmation = fillTemplate(defaultTemplate('demo_confirm')!.body[ctx.lang], [
    state.studentName!,
    course.shortName,
    longDayLabel(state.date!, ctx.today, ctx.lang),
    formatTime(batch.startTime),
    ctx.address ?? ctx.orgName,
  ])
  return {
    content: { kind: 'text', body: `${confirmation}\n${FLOW.booked[ctx.lang]}` },
    state: null,
    actions: [
      {
        type: 'book_demo',
        courseId: course.id,
        batchId: batch.id,
        date: state.date!,
        startTime: batch.startTime,
        studentName: state.studentName!,
      },
    ],
  }
}

/** "subah", "shaam wala", "5 baje", "10:30", "4 pm" → the matching batch, if exactly one fits. */
export function parseSlot(text: string, slots: Batch[]): Batch | null {
  const t = text.toLowerCase()
  const startHour = (b: Batch) => Number(b.startTime.slice(0, 2))
  let fits: Batch[] = []
  const hour = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|baje|bje)?\b/)
  if (hour) {
    let h = Number(hour[1])
    if (hour[3] === 'pm' && h < 12) h += 12
    if (hour[3] === 'am' && h === 12) h = 0
    const candidates = hour[3] === 'am' || hour[3] === 'pm' || h > 12 ? [h] : [h, h + 12]
    fits = slots.filter((b) => candidates.includes(startHour(b)))
  } else if (/subah|savere|morning|सुबह/u.test(t)) fits = slots.filter((b) => startHour(b) < 12)
  else if (/dopahar|afternoon|दोपहर/u.test(t))
    fits = slots.filter((b) => startHour(b) >= 12 && startHour(b) < 16)
  else if (/shaam|sham|evening|शाम/u.test(t)) fits = slots.filter((b) => startHour(b) >= 16)
  return fits.length === 1 ? fits[0]! : null
}

const NAME_PREFIX =
  /^(mera naam|meri beti ka naam|mere bete ka naam|student ka naam|naam|my name is|name is|name|मेरा नाम|नाम)\s*(hai|है|is|:)?\s*/iu
const NAME_SUFFIX = /\s+(hai|he|h|है)\.?$/iu
const NOT_A_NAME =
  /^(ha+n?|haa+|yes|no|nahi|ok|okay|theek|thik|kal|aaj|parso|demo|fees?|hello|hi|namaste|haan ji)$/iu

/** "Mera naam Anil Kumar hai" → "Anil Kumar". Null for anything that isn't plausibly a name. */
export function cleanName(text: string): string | null {
  const name = text
    .trim()
    .replace(NAME_PREFIX, '')
    .replace(NAME_SUFFIX, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!name || name.length < 2 || name.length > 40 || name.includes('?')) return null
  if (!/^[\p{L}\p{M}.' ]+$/u.test(name) || name.split(' ').length > 4) return null
  if (NOT_A_NAME.test(name)) return null
  // Typed names arrive in any case on phones: "anil kumar" → "Anil Kumar". Devanagari has no case.
  return name.replace(/\b\p{Ll}/gu, (c) => c.toUpperCase())
}

export function isDemoState(value: unknown): value is DemoState {
  return !!value && typeof value === 'object' && typeof (value as DemoState).step === 'string'
}
