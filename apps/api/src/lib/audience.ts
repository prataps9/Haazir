import { z } from 'zod'
import { LEAD_STAGES } from '@haazir/shared'

/** The filters a campaign audience, a saved segment and the contacts list share. */
export const audienceSchema = z
  .object({
    tags: z.array(z.string().trim().min(1).max(30)).max(20).optional(),
    stages: z.array(z.enum(LEAD_STAGES)).max(LEAD_STAGES.length).optional(),
    courseIds: z.array(z.uuid()).max(50).optional(),
    batchIds: z.array(z.uuid()).max(100).optional(),
  })
  .strict()

/** A cell that Excel can't mistake for a formula, quoted when it needs to be. */
export const csvCell = (v: unknown) => {
  const s = v == null ? '' : v instanceof Date ? v.toISOString() : String(v)
  // A leading = + - @ turns a cell into a formula in Excel: neutralise it.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}
