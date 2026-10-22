import type { LeadStage } from '@haazir/shared'
import type { StatusTone } from '@/components/StatusPill'

/** Lead stage as tone + icon + label, the same on cards, the chat header and the sheet. */
export const STAGE_TONE: Record<LeadStage, StatusTone> = {
  new: 'attention',
  contacted: 'neutral',
  demo_booked: 'bot',
  demo_done: 'bot',
  admitted: 'success',
  lost: 'danger',
}

const DAY_MS = 86_400_000

/** Whole days a lead has sat in its stage. */
export const daysIn = (since: string, now = Date.now()) =>
  Math.max(0, Math.floor((now - new Date(since).getTime()) / DAY_MS))

/** Follow-up due: overdue (before today), today, or later, in India time. */
export function followupState(
  at: string | null,
  now = new Date(),
): 'overdue' | 'today' | 'later' | null {
  if (!at) return null
  const ist = (d: Date) => new Date(d.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10)
  const day = ist(new Date(at))
  const today = ist(now)
  return day < today ? 'overdue' : day === today ? 'today' : 'later'
}
