import { generateText, Output, type LanguageModel } from 'ai'
import { z } from 'zod'
import { parseRupeesToPaise } from '@haazir/shared'

/**
 * Brochure auto-extract (spec §12): a draft of the institute's courses,
 * batches, address, phone and hours from its brochure text. A draft only:
 * onboarding shows it as editable cards and nothing reaches the bot until
 * the owner confirms. Amounts are read as text and converted here, so a
 * model that writes "₹4,500/-" or "4500 rs" still lands on 450000 paise.
 */
const money = z.string().describe('As written in the brochure, e.g. "₹4,500" or "4500/-"')

export const brochureSchema = z.object({
  courses: z
    .array(
      z.object({
        name: z.string(),
        shortName: z.string().describe('At most 24 characters, e.g. "RS-CIT", "Tally Prime + GST"'),
        description: z.string().optional(),
        duration: z.string().optional().describe('e.g. "3 mahine", "6 months"'),
        fee: money.optional(),
        installments: z
          .array(z.object({ label: z.string(), amount: money, afterDays: z.number().optional() }))
          .optional(),
        mode: z.enum(['offline', 'online', 'hybrid']).optional(),
      }),
    )
    .max(30),
  batches: z
    .array(
      z.object({
        course: z.string().describe('Which course, by its short name'),
        name: z.string().optional(),
        days: z.array(z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])).optional(),
        startTime: z.string().optional().describe('24-hour HH:mm'),
        endTime: z.string().optional().describe('24-hour HH:mm'),
      }),
    )
    .max(60),
  address: z.string().optional(),
  phone: z.string().optional(),
  hours: z.string().optional().describe('Opening hours as written'),
})

export type BrochureDraft = ReturnType<typeof toDraft>

const INSTRUCTIONS = `You read the brochure of a computer coaching institute in India and list what it states.
Only include what the text actually says; leave a field out rather than guess. Copy fees exactly as written.
Short names must be at most 24 characters.`

/** Turns the model's reading into the shape the onboarding cards edit, with fees in paise. */
function toDraft(raw: z.infer<typeof brochureSchema>) {
  const hhmm = (t?: string) => (t && /^([01]\d|2[0-3]):[0-5]\d$/.test(t) ? t : undefined)
  return {
    courses: raw.courses.map((c) => {
      const installments = (c.installments ?? [])
        .map((i) => ({
          label: i.label.slice(0, 40),
          amountPaise: parseRupeesToPaise(cleanMoney(i.amount)),
          dueOffsetDays: Math.max(0, Math.round(i.afterDays ?? 0)),
        }))
        .filter(
          (i): i is { label: string; amountPaise: number; dueOffsetDays: number } =>
            i.amountPaise !== null,
        )
      return {
        name: c.name.slice(0, 120),
        shortName: (c.shortName || c.name).slice(0, 24),
        description: c.description?.slice(0, 1000),
        durationText: c.duration?.slice(0, 40),
        mode: c.mode ?? 'offline',
        feeTotalPaise: c.fee ? parseRupeesToPaise(cleanMoney(c.fee)) : null,
        installmentPlan: installments,
      }
    }),
    batches: raw.batches.map((b) => ({
      course: b.course,
      name: b.name?.slice(0, 60),
      days: b.days ?? [],
      startTime: hhmm(b.startTime),
      endTime: hhmm(b.endTime),
    })),
    address: raw.address?.slice(0, 300),
    phone: raw.phone,
    hours: raw.hours,
  }
}

/** "₹4,500/-", "Rs. 4500", "4,500 rupaye" → "4,500". */
function cleanMoney(s: string) {
  return s.replace(/(rs\.?|inr|rupaye|rupees|\/-|-\/)/gi, '').trim()
}

export async function extractBrochure(model: LanguageModel, text: string): Promise<BrochureDraft> {
  const result = await generateText({
    model,
    system: INSTRUCTIONS,
    messages: [{ role: 'user', content: text.slice(0, 40_000) }],
    output: Output.object({ schema: brochureSchema }),
    temperature: 0,
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(60_000),
  })
  return toDraft(brochureSchema.parse(result.output))
}
