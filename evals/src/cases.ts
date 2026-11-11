import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { z } from 'zod'
import { INTENTS } from '@haazir/ai-core'

/** One eval file format (spec §11.7). */
const oneOrMany = <T extends z.ZodType>(t: T) => z.union([t, z.array(t)])

export const expectSchema = z
  .object({
    intent: oneOrMany(z.enum(INTENTS)).optional(),
    language: z.enum(['hi', 'en', 'hinglish']).optional(),
    script: z.enum(['devanagari', 'latin']).optional(),
    kind: z.enum(['reply', 'handoff', 'optout', 'optin', 'silent']).optional(),
    handoff: z.boolean().optional(),
    handoff_reason: z.string().optional(),
    /** Every one must appear (case-insensitive; "4500" matches "₹4,500"). */
    must_include: z.array(z.string()).optional(),
    /** At least one must appear. */
    must_include_any: z.array(z.string()).optional(),
    must_not_include: z.array(z.string()).optional(),
    max_chars: z.number().optional(),
  })
  .strict()

export const caseSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    org_fixture: z.literal('shiksha-sikar').default('shiksha-sikar'),
    tags: z.array(z.string()).min(1),
    turns: z
      .array(
        z
          .object({
            user: z.string().min(1),
            /** `audio`: the text is a voice-note transcript. */
            type: z.enum(['text', 'audio']).default('text'),
            /** Simulates tapping a menu button with this id. */
            interactive_id: z.string().optional(),
            expect: expectSchema,
          })
          .strict(),
      )
      .min(1),
  })
  .strict()

export type EvalCase = z.infer<typeof caseSchema>
export type Expectation = z.infer<typeof expectSchema>

export const CASES_DIR = fileURLToPath(new URL('../cases', import.meta.url))

export function loadCases(dir = CASES_DIR): EvalCase[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.yaml'))
    .sort()
    .flatMap((file) => {
      const raw = parse(readFileSync(join(dir, file), 'utf8')) as unknown[]
      return raw.map((c, i) => {
        const parsed = caseSchema.safeParse(c)
        if (!parsed.success) {
          throw new Error(
            `${file} case ${i + 1}: ${parsed.error.issues.map((e) => `${e.path.join('.')} ${e.message}`).join('; ')}`,
          )
        }
        return parsed.data
      })
    })
}
