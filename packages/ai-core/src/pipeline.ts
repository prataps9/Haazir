import { generateText, stepCountIs, type ModelMessage } from 'ai'
import { and, desc, eq, gte, sql } from 'drizzle-orm'
import {
  batches,
  botConfigs,
  contacts,
  conversations,
  courses,
  demoBookings,
  leads,
  messages,
  orgPaymentAccounts,
  organizations,
  type AnyDatabase,
} from '@haazir/db'
import type { BusinessHours } from '@haazir/shared'
import type { AgentAction } from './actions'
import { COPY, pick } from './copy'
import { parseDay } from './flows/calendar'
import { fill, FLOW, BUTTON } from './flows/copy'
import { courseCard, courseList } from './flows/courses'
import {
  cleanName,
  continueDemo,
  DEMO_FLOW_TTL_MS,
  isDemoState,
  repromptDemo,
  startDemo,
  type DemoState,
  type FlowContext,
  type FlowResult,
} from './flows/demo'
import { matchCourse } from './match'
import { explainViolations, looksLikeInjection, runGuardrails } from './guardrails'
import { describeOpening, hoursToday, isOpen, localParts, nextOpening } from './hours'
import { detectLanguage, scriptFor, type ReplyLanguage } from './language'
import { ANSWER_PROMPT_VERSION, buildAnswerPrompt } from './prompts/answer'
import type { Models } from './providers'
import { retrieve, type RetrievedChunk } from './retrieval'
import { route, type Intent } from './router'
import { createTools, type ToolContext } from './tools'

/** A reply the pipeline wants sent. Mirrors @haazir/whatsapp's OutboundContent (text or buttons). */
export type ReplyContent =
  | { kind: 'text'; body: string }
  | { kind: 'buttons'; body: string; buttons: { id: string; title: string }[] }
  | {
      kind: 'list'
      body: string
      buttonLabel: string
      sections: { title?: string; rows: { id: string; title: string; description?: string }[] }[]
    }

/** What `conversations.flow_state` holds between messages. */
export interface FlowStore {
  /** Unclear messages in a row (one clarifying question, then a handoff). */
  clarifyMisses?: number
  /** A demo booking in progress. */
  demo?: DemoState
  /** The language of the bot's last reply, for taps (a button title says little). */
  lang?: ReplyLanguage
}

export interface TraceData {
  intent: string | null
  language: string | null
  confidence: number | null
  retrievedChunkIds: string[]
  toolCalls: { name: string; input: unknown; output?: unknown }[]
  model: string | null
  promptVersion: string | null
  inputTokens: number
  outputTokens: number
  latencyMs: number
  guardrailFlags: string[]
}

export type HandoffReason =
  | 'missing_info'
  | 'upset'
  | 'asked_for_human'
  | 'sensitive'
  | 'media'
  | 'voice_unclear'
  | 'bot_disabled'
  | 'ai_unavailable'
  | 'rate_limit'
  | 'guardrail'
  | 'low_confidence'
  | 'other'

export type Decision =
  /** Send this, do these, and remember this for the next message. */
  | {
      kind: 'reply'
      content: ReplyContent
      trace: TraceData
      actions: AgentAction[]
      flowState: FlowStore | null
    }
  /** Tell the person the team will reply, and put the chat in human mode. */
  | {
      kind: 'handoff'
      content: ReplyContent
      reason: HandoffReason
      summary: string
      /** The question to add to "teach your bot", when the bot lacked the facts. */
      unanswered?: string
      trace: TraceData
      actions: AgentAction[]
    }
  /** Mark the contact opted out and send the single confirmation. */
  | { kind: 'optout'; content: ReplyContent; trace: TraceData }
  /** Say nothing (staff are handling it, or there's nothing to answer). */
  | { kind: 'silent'; reason: string }

export interface PipelineDeps {
  db: AnyDatabase
  /** Null when no LLM is configured: every conversation goes to a person. */
  models: Models | null
  now(): Date
  log?: { warn(obj: object, msg?: string): void }
}

export interface Turn {
  orgId: string
  conversationId: string
  messageId: string
}

const HUMAN_MODE_MS = 2 * 60 * 60 * 1000
const MEDIA_TYPES = new Set(['image', 'video', 'document', 'sticker'])
const SILENT_TYPES = new Set(['location', 'reaction', 'contacts', 'unsupported'])
const ANSWER_INTENTS_WITH_BUTTONS = new Set<Intent>([
  'course_info',
  'fee_query',
  'batch_timing',
  'admission',
])

const GREETING =
  /^(hi+|hello+|hey|helo|namaste|namaskar|namskar|ram ram|jai shree krishna|good (morning|afternoon|evening)|नमस्ते|नमस्कार|राम राम|हेलो|हाय)[\s!.,]*$/iu
const DEMO_WORD = /\b(demo|trial)\b|डेमो/iu

const emptyTrace = (): TraceData => ({
  intent: null,
  language: null,
  confidence: null,
  retrievedChunkIds: [],
  toolCalls: [],
  model: null,
  promptVersion: null,
  inputTokens: 0,
  outputTokens: 0,
  latencyMs: 0,
  guardrailFlags: [],
})

const normaliseText = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** "STOP", "band karo", "मत भेजो": the whole message, or a very short one containing it. */
export function isKeywordMessage(text: string, keywords: string[]): boolean {
  const t = normaliseText(text)
  if (!t) return false
  return keywords.some((k) => {
    const kw = normaliseText(k)
    if (!kw) return false
    if (t === kw) return true
    return t.split(' ').length <= 5 && ` ${t} `.includes(` ${kw} `)
  })
}

/**
 * Decides what the bot does with one inbound message (spec §11.1). Reads the
 * database but writes nothing: the caller applies the decision (send, hand
 * over, opt out, trace), so this can also power the playground and evals.
 */
export async function decideReply(deps: PipelineDeps, turn: Turn): Promise<Decision> {
  const started = Date.now()
  const { db } = deps
  const now = deps.now()

  const [row] = await db
    .select({
      message: messages,
      conversation: conversations,
      contact: contacts,
      org: organizations,
      bot: botConfigs,
    })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
    .innerJoin(organizations, eq(organizations.id, conversations.orgId))
    .leftJoin(botConfigs, eq(botConfigs.orgId, conversations.orgId))
    .where(and(eq(messages.id, turn.messageId), eq(messages.orgId, turn.orgId)))
  if (!row) return { kind: 'silent', reason: 'message_not_found' }
  const { message, conversation, contact, org, bot } = row

  // Staff have the chat. Their silence for 2h hands it back to the bot.
  if (conversation.mode === 'human') {
    if (!conversation.humanUntil || conversation.humanUntil > now) {
      return { kind: 'silent', reason: 'human_mode' }
    }
  }
  if (conversation.mode === 'closed') return { kind: 'silent', reason: 'closed' }

  const text = (message.type === 'audio' ? message.transcript : message.body)?.trim() ?? ''
  const guessLang: ReplyLanguage = text ? detectLanguage(text) : 'hinglish'
  const trace = emptyTrace()
  const finish = <T extends Decision>(d: T): T => {
    if ('trace' in d) d.trace.latencyMs = Date.now() - started
    return d
  }
  const store = (conversation.flowState ?? {}) as FlowStore
  const activeDemo =
    isDemoState(store.demo) && now.getTime() - Date.parse(store.demo.at) < DEMO_FLOW_TTL_MS
      ? store.demo
      : null
  const actions: AgentAction[] = []
  const reply = (
    content: ReplyContent,
    lang: ReplyLanguage,
    next: { demo?: DemoState | null; clarifyMisses?: number } = {},
  ) => {
    trace.language ??= lang
    const flowState: FlowStore = { lang }
    if (next.demo) flowState.demo = next.demo
    if (next.clarifyMisses) flowState.clarifyMisses = next.clarifyMisses
    return finish({ kind: 'reply' as const, content, trace, actions, flowState })
  }

  const handoff = (
    reason: HandoffReason,
    summary: string,
    lang: ReplyLanguage,
    extra: { copy?: Record<ReplyLanguage, string>; body?: string; unanswered?: string } = {},
  ) => {
    let body =
      extra.body ?? (extra.copy ? extra.copy[lang] : pick(bot?.fallbackMessage, COPY.handoff, lang))
    if (!isOpen(org.businessHours as BusinessHours | null, now, org.timezone)) {
      const when = describeOpening(
        nextOpening(org.businessHours as BusinessHours | null, now, org.timezone),
        lang,
      )
      body += ` ${pick(bot?.afterHoursMessage, COPY.afterHours, lang).replace('{when}', when)}`
    }
    trace.language ??= lang
    return finish({
      kind: 'handoff' as const,
      content: { kind: 'text' as const, body },
      reason,
      summary,
      unanswered: extra.unanswered,
      trace,
      actions,
    })
  }

  // ---- Pre-checks: no LLM ----

  if (message.type === 'audio' && !text) {
    return handoff('voice_unclear', 'Voice note bheja, samajh nahi aaya', guessLang, {
      copy: COPY.voiceUnclear,
    })
  }
  if (MEDIA_TYPES.has(message.type)) {
    const copy = message.type === 'document' ? COPY.file : COPY.photo
    return handoff(
      'media',
      `${message.type === 'document' ? 'File' : 'Photo'} bheji hai`,
      guessLang,
      { copy },
    )
  }
  if (SILENT_TYPES.has(message.type)) return { kind: 'silent', reason: `type_${message.type}` }

  const optoutWords = bot?.optoutKeywords?.length ? bot.optoutKeywords : ['stop', 'unsubscribe']
  if (text && isKeywordMessage(text, optoutWords)) {
    trace.intent = 'opt_out'
    trace.language = guessLang
    return finish({
      kind: 'optout',
      content: { kind: 'text', body: COPY.optOut[guessLang] },
      trace,
    })
  }

  if (text && bot?.handoffKeywords?.length && isKeywordMessage(text, bot.handoffKeywords)) {
    return handoff('asked_for_human', 'Kisi insaan se baat karna chahte hain', guessLang)
  }
  if (bot && !bot.enabled) return handoff('bot_disabled', 'Bot band hai', guessLang)

  const limit = bot?.maxAiRepliesPerContactHour ?? 20
  const recentBotReplies = await db.$count(
    messages,
    and(
      eq(messages.conversationId, conversation.id),
      eq(messages.direction, 'out'),
      eq(messages.sentBy, 'bot'),
      gte(messages.createdAt, new Date(now.getTime() - 60 * 60 * 1000)),
    ),
  )
  if (recentBotReplies >= limit) {
    return handoff('rate_limit', 'Ek ghante mein bahut saare sawaal', guessLang)
  }

  if (!text) return { kind: 'silent', reason: 'empty' }

  // ---- Taps and flows: no LLM needed (spec §11.1, §11.5) ----

  const tap = message.interactive as { id?: string; title?: string } | null
  const tapId = tap?.id
  // A tapped title ("Free demo") says little about language; the last reply's does.
  const tapLang: ReplyLanguage = tapId ? (store.lang ?? guessLang) : guessLang
  let flowCtx: FlowContext | null = null
  const flow = async (lang: ReplyLanguage) => {
    flowCtx ??= await loadFlowContext(db, org, now, lang, contact.name || contact.profileName)
    flowCtx.lang = lang
    return flowCtx
  }
  const fromFlow = (r: FlowResult, lang: ReplyLanguage) => {
    actions.push(...(r.actions ?? []))
    if (r.handoff) {
      return handoff(r.handoff.reason, r.handoff.summary, lang, {
        body: r.content.body,
        unanswered: r.handoff.summary,
      })
    }
    return reply(r.content, lang, { demo: r.state })
  }

  if (tapId) {
    trace.intent = `tap:${tapId.split(':')[0]}`
    const tapped = await handleTap(tapId, tapLang)
    if (tapped) return tapped
  }

  if (activeDemo) {
    const ctx = await flow(tapLang)
    const step = continueDemo(activeDemo, { id: tapId, title: tap?.title, text }, ctx)
    if (step) {
      trace.intent ??= 'demo_booking'
      return fromFlow(step, tapLang)
    }
    if (!deps.models) {
      // Without AI we can't answer the aside: ask again, then hand over.
      const misses = (activeDemo.misses ?? 0) + 1
      if (misses >= 2) {
        return handoff('low_confidence', `Demo booking ke beech: ${text.slice(0, 80)}`, tapLang)
      }
      return reply(repromptDemo(activeDemo, ctx, FLOW.pleaseChoose[tapLang]), tapLang, {
        demo: { ...activeDemo, misses },
      })
    }
    // With AI: answer the aside below, then offer to carry on with the booking.
  }

  if (!deps.models) {
    // No AI configured: the menu, courses and demo booking still work by rules.
    const lang = guessLang
    if (GREETING.test(text)) return reply(await mainMenu(lang), lang)
    if (DEMO_WORD.test(text)) {
      const ctx = await flow(lang)
      const course = matchCourse(ctx.courses, text)
      return fromFlow(
        startDemo(ctx, { courseId: course?.id, date: parseDay(text, ctx.today) ?? undefined }),
        lang,
      )
    }
    const ctx = await flow(lang)
    const course =
      text.length <= 40
        ? matchCourse(
            ctx.courses.filter((c) => c.active),
            text,
          )
        : null
    if (course) {
      actions.push({ type: 'upsert_lead', courseId: course.id })
      return reply(courseCard(course, lang), lang)
    }
    return handoff('ai_unavailable', text.slice(0, 80) || 'Naya message', guessLang)
  }

  // ---- Understanding ----

  const history = await loadHistory(db, conversation.id, message.id)
  const routed = await route(deps.models.fast, history, text)
  // The router is told the characters decide the script; for Hinglish vs English,
  // trust the model only when it answered.
  const lang: ReplyLanguage = routed.fromModel ? routed.language : guessLang
  trace.intent = routed.intent
  trace.language = lang
  trace.confidence = routed.confidence
  trace.inputTokens += routed.inputTokens ?? 0
  trace.outputTokens += routed.outputTokens ?? 0
  if (looksLikeInjection(text)) trace.guardrailFlags.push('injection_attempt')

  if (routed.intent === 'talk_to_human') {
    return handoff('asked_for_human', 'Kisi insaan se baat karna chahte hain', lang)
  }
  if (routed.intent === 'complaint') {
    return handoff('upset', `Shikayat: ${text.slice(0, 80)}`, lang)
  }

  // Whatever course they named goes on their lead, so staff see what they asked about.
  const ctx = await flow(lang)
  const namedCourse = routed.entities.course
    ? matchCourse(
        ctx.courses.filter((c) => c.active),
        routed.entities.course,
      )
    : null
  if (namedCourse) actions.push({ type: 'upsert_lead', courseId: namedCourse.id })

  if (routed.intent === 'greeting' && !activeDemo) return reply(await mainMenu(lang), lang)
  if (routed.intent === 'demo_booking' && !activeDemo) {
    return fromFlow(
      startDemo(ctx, {
        courseId: namedCourse?.id,
        date: routed.entities.date
          ? (parseDay(routed.entities.date, ctx.today) ?? undefined)
          : undefined,
        studentName: routed.entities.name
          ? (cleanName(routed.entities.name) ?? undefined)
          : undefined,
      }),
      lang,
    )
  }

  const menuButtons = await menuButtonsFor(lang)

  // ---- Context ----

  let chunks: RetrievedChunk[] = []
  try {
    chunks = await retrieve(db, deps.models.embedding, org.id, text)
  } catch (err) {
    deps.log?.warn({ err: (err as Error).message }, 'retrieval failed; answering from tools only')
  }
  trace.retrievedChunkIds = chunks.map((c) => c.id)

  // Nothing understood and nothing found: ask once with the menu, then hand over.
  const misses = store.clarifyMisses ?? 0
  if (routed.confidence < 0.5 && chunks.length === 0 && routed.intent === 'other') {
    if (misses >= 1) {
      return handoff('low_confidence', `Samajh nahi aaya: ${text.slice(0, 80)}`, lang, {
        unanswered: text,
      })
    }
    return reply({ kind: 'buttons', body: COPY.clarify[lang], buttons: menuButtons }, lang, {
      clarifyMisses: misses + 1,
      demo: activeDemo,
    })
  }

  // ---- Answer ----

  const local = localParts(now, org.timezone)
  const toolCtx = await createToolContext(db, org, { contactId: contact.id, flow: ctx })
  const hoursLine = hoursToday(org.businessHours as BusinessHours | null, now, org.timezone)
  const nowLine = `${local.day} ${local.date} ${local.time} IST`
  const system = buildAnswerPrompt({
    personaName: bot?.personaName ?? 'Haazir Sahayak',
    orgName: org.name,
    verticalLabel: org.vertical === 'coaching' ? 'computer training institute' : org.vertical,
    city: org.city ?? '',
    address: org.address,
    retrievedChunks: chunks.map((c) => c.content),
    hoursToday: hoursLine,
    nowIst: nowLine,
    replyLanguage: lang,
  })
  const tools = createTools(toolCtx)
  const convo: ModelMessage[] = [...history, { role: 'user', content: text }]

  const generate = async (msgs: ModelMessage[]) => {
    const result = await generateText({
      model: deps.models!.smart,
      system,
      messages: msgs,
      tools,
      stopWhen: stepCountIs(5),
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(20_000),
    })
    trace.inputTokens += result.totalUsage.inputTokens ?? 0
    trace.outputTokens += result.totalUsage.outputTokens ?? 0
    return result.text.trim()
  }

  trace.model = deps.models.ids.smart
  trace.promptVersion = ANSWER_PROMPT_VERSION

  let draft: string
  try {
    draft = await generate(convo)
  } catch (err) {
    deps.log?.warn({ err: (err as Error).message }, 'answer model failed')
    trace.toolCalls = toolCtx.toolCalls
    return handoff('ai_unavailable', text.slice(0, 80), lang)
  }

  const sources = () => [
    ...toolCtx.facts,
    ...chunks.map((c) => c.content),
    text,
    hoursLine,
    nowLine,
    org.address ?? '',
    ...history.map((m) => (typeof m.content === 'string' ? m.content : '')),
  ]
  const check = (reply: string) =>
    runGuardrails({
      reply,
      sources: sources(),
      expectedScript: scriptFor(lang),
      competitors: bot?.competitorNames ?? [],
    })

  let verdict = check(draft)
  if (!toolCtx.handoff && !verdict.ok) {
    trace.guardrailFlags.push(...verdict.violations)
    // One retry, with the problems spelled out (spec §11.1).
    try {
      draft = await generate([
        ...convo,
        { role: 'assistant', content: draft },
        {
          role: 'user',
          content: `[Rules check, not from the customer] Your reply broke these rules:\n${explainViolations(verdict.violations)}\nWrite the reply again, following the rules.`,
        },
      ])
      verdict = check(draft)
    } catch {
      /* treated as a failed retry below */
    }
  }
  trace.toolCalls = toolCtx.toolCalls
  // A rewritten reply ran the tools again: keep each action once.
  const seen = new Set<string>()
  for (const a of toolCtx.actions) {
    const key = JSON.stringify(a)
    if (!seen.has(key)) actions.push(a)
    seen.add(key)
  }

  if (toolCtx.handoff) {
    const reason = toolCtx.handoff.reason as HandoffReason
    return handoff(reason, toolCtx.handoff.summary, lang, {
      unanswered: reason === 'missing_info' ? text : undefined,
    })
  }
  if (!verdict.ok) {
    trace.guardrailFlags.push(...verdict.violations.map((v) => `retry:${v}`))
    return handoff(
      'guardrail',
      `Bot ka jawab rules par khara nahi utra: ${text.slice(0, 60)}`,
      lang,
    )
  }

  const body = verdict.reply
  const booked = actions.some((a) => a.type === 'book_demo')
  if (activeDemo && !booked) {
    // Answered the aside; the booking is still waiting (spec §11.5).
    return reply(
      {
        kind: 'buttons',
        body: `${body}\n\n${FLOW.continuePrompt[lang]}`.slice(0, 1024),
        buttons: [
          { id: 'demo_continue', title: BUTTON.continue[lang] },
          { id: 'demo_cancel', title: BUTTON.cancel[lang] },
        ],
      },
      lang,
      { demo: { ...activeDemo, misses: 0 } },
    )
  }
  const content: ReplyContent =
    ANSWER_INTENTS_WITH_BUTTONS.has(routed.intent) && !booked
      ? { kind: 'buttons', body, buttons: [menuButtons[1]!, menuButtons[2]!] }
      : { kind: 'text', body }
  return reply(content, lang)

  // ---- Helpers that need this turn's data ----

  async function menuButtonsFor(lang: ReplyLanguage) {
    // Button titles the owner set in bot settings, else ours. The ids are fixed.
    const menuTitle = (id: string, fallback: Record<ReplyLanguage, string>) =>
      pick(bot?.mainMenu.find((m) => m.id === id)?.title, fallback, lang).slice(0, 20)
    return [
      { id: 'menu_courses', title: menuTitle('menu_courses', COPY.courses) },
      { id: 'menu_demo', title: menuTitle('menu_demo', COPY.demo) },
      { id: 'menu_talk', title: menuTitle('menu_talk', COPY.talk) },
    ]
  }

  async function mainMenu(lang: ReplyLanguage): Promise<ReplyContent> {
    const body = pick(
      bot?.greeting,
      {
        hinglish: `Namaste! ${org.name} mein aapka swagat hai. Main aapki kya madad karun?`,
        hi: `नमस्ते! ${org.name} में आपका स्वागत है। मैं आपकी क्या मदद करूँ?`,
        en: `Hello! Welcome to ${org.name}. How can I help you?`,
      },
      lang,
    )
    trace.intent ??= 'greeting'
    return { kind: 'buttons', body, buttons: await menuButtonsFor(lang) }
  }

  /** Buttons and list rows with a fixed meaning: menu, course cards, brochures, reminder answers. */
  async function handleTap(id: string, lang: ReplyLanguage) {
    const [kind, ref] = id.split(':') as [string, string | undefined]
    switch (kind) {
      case 'menu_talk':
        return handoff('asked_for_human', 'Kisi insaan se baat karna chahte hain', lang)
      case 'menu_courses': {
        const ctx = await flow(lang)
        const list = courseList(ctx.courses, lang)
        return list
          ? reply(list, lang)
          : handoff('missing_info', 'Courses ki list maangi', lang, { body: FLOW.noCourses[lang] })
      }
      case 'course': {
        const course = (await flow(lang)).courses.find((c) => c.id === ref && c.active)
        if (!course) return null
        actions.push({ type: 'upsert_lead', courseId: course.id })
        return reply(courseCard(course, lang), lang)
      }
      case 'menu_demo':
      case 'demo_course': {
        if (activeDemo && kind === 'demo_course') return null // the flow takes it from here
        const ctx = await flow(lang)
        const [lead] = await db
          .select({ courseId: leads.courseId, studentName: leads.studentName })
          .from(leads)
          .where(and(eq(leads.orgId, org.id), eq(leads.contactId, contact.id)))
        trace.intent = 'demo_booking'
        return fromFlow(
          startDemo(ctx, {
            courseId: ref ?? lead?.courseId ?? undefined,
            studentName: lead?.studentName ?? undefined,
          }),
          lang,
        )
      }
      case 'brochure': {
        const course = (await flow(lang)).courses.find((c) => c.id === ref)
        if (!course) return null
        if (course.brochureKey) {
          actions.push({ type: 'send_brochure', courseId: course.id })
          return reply(
            { kind: 'text', body: fill(FLOW.brochureComing[lang], { course: course.shortName }) },
            lang,
          )
        }
        return reply(
          { kind: 'text', body: fill(FLOW.noBrochure[lang], { course: course.shortName }) },
          lang,
        )
      }
      case 'demo_yes':
      case 'demo_reschedule': {
        // Answers to the demo reminder template (payload "demo_yes:<booking id>").
        if (!ref) return null
        const [booking] = await db
          .select()
          .from(demoBookings)
          .where(
            and(
              eq(demoBookings.id, ref),
              eq(demoBookings.orgId, org.id),
              eq(demoBookings.contactId, contact.id),
            ),
          )
        if (!booking) return null
        if (kind === 'demo_yes') {
          actions.push({ type: 'demo_answer', bookingId: booking.id, answer: 'coming' })
          return reply(
            {
              kind: 'text',
              body: fill(FLOW.comingThanks[lang], { address: org.address ?? org.name }),
            },
            lang,
          )
        }
        actions.push({ type: 'demo_answer', bookingId: booking.id, answer: 'reschedule' })
        return fromFlow(
          startDemo(await flow(lang), {
            courseId: booking.courseId ?? undefined,
            studentName: booking.studentName,
          }),
          lang,
        )
      }
      default:
        // A tap on an old booking list after the flow expired: start afresh.
        if (kind.startsWith('demo_') && !activeDemo)
          return fromFlow(startDemo(await flow(lang)), lang)
        return null
    }
  }
}

/** What the tools need for one conversation: the org, the contact and the demo slots. */
export async function createToolContext(
  db: AnyDatabase,
  org: typeof organizations.$inferSelect,
  input: { contactId: string; flow: FlowContext },
): Promise<ToolContext> {
  const payments = await db.$count(
    orgPaymentAccounts,
    and(eq(orgPaymentAccounts.orgId, org.id), eq(orgPaymentAccounts.status, 'connected')),
  )
  return {
    db,
    orgId: org.id,
    today: input.flow.today,
    facts: [],
    toolCalls: [],
    handoff: null,
    contactId: input.contactId,
    actions: [],
    org: {
      name: org.name,
      address: org.address,
      mapsUrl: org.mapsUrl,
      hasLocation: org.latitude != null && org.longitude != null,
      paymentsEnabled: payments > 0,
    },
    flow: input.flow,
  }
}

/** Courses, batches and the clock, as the demo flow and the demo tools see them. */
export async function loadFlowContext(
  db: AnyDatabase,
  org: typeof organizations.$inferSelect,
  now: Date,
  lang: ReplyLanguage,
  knownName: string | null,
): Promise<FlowContext> {
  const local = localParts(now, org.timezone)
  const [courseRows, batchRows] = await Promise.all([
    db.select().from(courses).where(eq(courses.orgId, org.id)).orderBy(courses.sort),
    db.select().from(batches).where(eq(batches.orgId, org.id)),
  ])
  return {
    courses: courseRows,
    batches: batchRows,
    today: local.date,
    nowTime: local.time,
    now,
    lang,
    orgName: org.name,
    address: org.address,
    knownName,
  }
}

/** The last 10 messages before this one, oldest first, as model messages. */
async function loadHistory(db: AnyDatabase, conversationId: string, beforeMessageId: string) {
  const rows = await db
    .select({
      id: messages.id,
      direction: messages.direction,
      body: messages.body,
      transcript: messages.transcript,
    })
    .from(messages)
    .where(
      and(eq(messages.conversationId, conversationId), sql`${messages.id} <> ${beforeMessageId}`),
    )
    .orderBy(desc(messages.createdAt))
    .limit(10)
  return rows
    .reverse()
    .map((m) => ({
      role: m.direction === 'in' ? 'user' : 'assistant',
      content: m.transcript ?? m.body ?? '',
    }))
    .filter((m) => m.content) as ModelMessage[]
}

export { HUMAN_MODE_MS }
