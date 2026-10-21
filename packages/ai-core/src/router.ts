import { generateText, Output, type LanguageModel, type ModelMessage } from 'ai'
import { z } from 'zod'
import { detectLanguage, detectScript } from './language'

/** The router's verdict (spec §11.1), validated with zod before anything trusts it. */
export const INTENTS = [
  'greeting',
  'course_info',
  'fee_query',
  'batch_timing',
  'demo_booking',
  'admission',
  'location',
  'certificate',
  'payment',
  'complaint',
  'talk_to_human',
  'thanks_bye',
  'other',
] as const
export type Intent = (typeof INTENTS)[number]

export const routerSchema = z.object({
  language: z.enum(['hi', 'en', 'hinglish']),
  script: z.enum(['devanagari', 'latin']),
  intent: z.enum(INTENTS),
  entities: z.object({
    course: z.string().optional(),
    date: z.string().optional(),
    time: z.string().optional(),
    name: z.string().optional(),
  }),
  confidence: z.number().min(0).max(1),
})
export type RouterResult = z.infer<typeof routerSchema> & {
  /** False when the model failed and this is the no-LLM fallback. */
  fromModel: boolean
  inputTokens?: number
  outputTokens?: number
}

const INSTRUCTIONS = `You classify WhatsApp messages sent to a computer coaching institute in Rajasthan.
Return the language and script of the LAST user message, its intent, any entities, and your confidence (0-1).
- language: "hi" = Hindi in Devanagari, "hinglish" = Hindi written in Roman letters, "en" = English.
- script: "devanagari" or "latin", from the characters actually used.
- intent: fee_query (fees, cost, installments, discount), course_info (what a course covers, duration),
  batch_timing (timings, start dates, seats), demo_booking (free/trial class), admission (how to join,
  documents), location (address, directions), certificate, payment (paying fees, links, receipts),
  complaint (upset, problem), talk_to_human (asks for a person or a call), greeting, thanks_bye, other.
- entities.course: the course they mean, as written (e.g. "rscit", "tally"). Only what is in the text.
- entities.date: a day they asked for, as written ("kal", "shanivar", "24 oct"). entities.name: the
  student's name, only if they wrote it.
Use earlier messages only to resolve references like "uski fees?".`

/** No LLM available or it failed: script and language from the text, intent unknown. */
export function fallbackRoute(text: string): RouterResult {
  return {
    language: detectLanguage(text),
    script: detectScript(text),
    intent: 'other',
    entities: {},
    confidence: 0,
    fromModel: false,
  }
}

export async function route(
  model: LanguageModel,
  history: ModelMessage[],
  text: string,
  options: { abortSignal?: AbortSignal } = {},
): Promise<RouterResult> {
  try {
    const result = await generateText({
      model,
      system: INSTRUCTIONS,
      messages: [...history.slice(-4), { role: 'user', content: text }],
      output: Output.object({ schema: routerSchema }),
      temperature: 0,
      maxRetries: 1,
      abortSignal: options.abortSignal ?? AbortSignal.timeout(6_000),
    })
    const parsed = routerSchema.parse(result.output)
    // The characters decide the script, whatever the model says: it's cheap
    // to know for certain and the reply-language guardrail depends on it.
    const script = detectScript(text)
    return {
      ...parsed,
      script,
      language:
        script === 'devanagari' ? 'hi' : parsed.language === 'hi' ? 'hinglish' : parsed.language,
      fromModel: true,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    }
  } catch {
    return fallbackRoute(text)
  }
}
