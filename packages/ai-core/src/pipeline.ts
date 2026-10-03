import { generateText, stepCountIs, type ModelMessage } from 'ai'
import { and, desc, eq, gte, sql } from 'drizzle-orm'
import {
  botConfigs,
  contacts,
  conversations,
  messages,
  organizations,
  type AnyDatabase,
} from '@haazir/db'
import type { BusinessHours } from '@haazir/shared'
import { COPY, pick } from './copy'
import { explainViolations, looksLikeInjection, runGuardrails } from './guardrails'
import { describeOpening, hoursToday, isOpen, localParts, nextOpening } from './hours'
import { detectLanguage, scriptFor, type ReplyLanguage } from './language'
import { ANSWER_PROMPT_VERSION, buildAnswerPrompt } from './prompts/answer'
import type { Models } from './providers'
import { retrieve, type RetrievedChunk } from './retrieval'
import { fallbackRoute, route, type Intent, type RouterResult } from './router'
import { createTools, type ToolContext } from './tools'

/** A reply the pipeline wants sent. Mirrors @haazir/whatsapp's OutboundContent (text or buttons). */
export type ReplyContent =
  | { kind: 'text'; body: string }
  | { kind: 'buttons'; body: string; buttons: { id: string; title: string }[] }

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
  /** Send this. */
  | { kind: 'reply'; content: ReplyContent; trace: TraceData; clarifyMisses?: number }
  /** Tell the person the team will reply, and put the chat in human mode. */
  | {
      kind: 'handoff'
      content: ReplyContent
      reason: HandoffReason
      summary: string
      /** The question to add to "teach your bot", when the bot lacked the facts. */
      unanswered?: string
      trace: TraceData
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

/** Interactive replies map straight to an intent (no LLM) (spec §11.1). */
const MENU_INTENTS: Record<string, Intent> = {
  menu_courses: 'course_info',
  menu_demo: 'demo_booking',
  menu_talk: 'talk_to_human',
}

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
  const { message, conversation, org, bot } = row

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

  const handoff = (
    reason: HandoffReason,
    summary: string,
    lang: ReplyLanguage,
    extra: { copy?: Record<ReplyLanguage, string>; unanswered?: string } = {},
  ) => {
    let body = extra.copy ? extra.copy[lang] : pick(bot?.fallbackMessage, COPY.handoff, lang)
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
  if (!deps.models) return handoff('ai_unavailable', text.slice(0, 80) || 'Naya message', guessLang)

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

  // ---- Understanding ----

  const history = await loadHistory(db, conversation.id, message.id)
  const interactiveId = (message.interactive as { id?: string } | null)?.id
  let routed: RouterResult
  if (interactiveId && MENU_INTENTS[interactiveId]) {
    routed = { ...fallbackRoute(text), intent: MENU_INTENTS[interactiveId]!, confidence: 1 }
  } else {
    routed = await route(deps.models.fast, history, text)
  }
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

  // Button titles the owner set in bot settings, else ours. The ids are fixed.
  const menuTitle = (id: string, fallback: Record<ReplyLanguage, string>) =>
    pick(bot?.mainMenu.find((m) => m.id === id)?.title, fallback, lang).slice(0, 20)
  const menuButtons = [
    { id: 'menu_courses', title: menuTitle('menu_courses', COPY.courses) },
    { id: 'menu_demo', title: menuTitle('menu_demo', COPY.demo) },
    { id: 'menu_talk', title: menuTitle('menu_talk', COPY.talk) },
  ]
  if (routed.intent === 'greeting') {
    const body = pick(
      bot?.greeting,
      {
        hinglish: `Namaste! ${org.name} mein aapka swagat hai. Main aapki kya madad karun?`,
        hi: `नमस्ते! ${org.name} में आपका स्वागत है। मैं आपकी क्या मदद करूँ?`,
        en: `Hello! Welcome to ${org.name}. How can I help you?`,
      },
      lang,
    )
    return finish({
      kind: 'reply',
      content: { kind: 'buttons', body, buttons: menuButtons },
      trace,
      clarifyMisses: 0,
    })
  }

  // ---- Context ----

  let chunks: RetrievedChunk[] = []
  try {
    chunks = await retrieve(db, deps.models.embedding, org.id, text)
  } catch (err) {
    deps.log?.warn({ err: (err as Error).message }, 'retrieval failed; answering from tools only')
  }
  trace.retrievedChunkIds = chunks.map((c) => c.id)

  // Nothing understood and nothing found: ask once with the menu, then hand over.
  const misses = Number(
    (conversation.flowState as { clarifyMisses?: number } | null)?.clarifyMisses ?? 0,
  )
  if (routed.confidence < 0.5 && chunks.length === 0 && routed.intent === 'other') {
    if (misses >= 1) {
      return handoff('low_confidence', `Samajh nahi aaya: ${text.slice(0, 80)}`, lang, {
        unanswered: text,
      })
    }
    return finish({
      kind: 'reply',
      content: { kind: 'buttons', body: COPY.clarify[lang], buttons: menuButtons },
      trace,
      clarifyMisses: misses + 1,
    })
  }

  // ---- Answer ----

  const local = localParts(now, org.timezone)
  const toolCtx: ToolContext = {
    db,
    orgId: org.id,
    today: local.date,
    facts: [],
    toolCalls: [],
    handoff: null,
  }
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
  const content: ReplyContent = ANSWER_INTENTS_WITH_BUTTONS.has(routed.intent)
    ? { kind: 'buttons', body, buttons: [menuButtons[1]!, menuButtons[2]!] }
    : { kind: 'text', body }
  return finish({ kind: 'reply', content, trace, clarifyMisses: 0 })
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
