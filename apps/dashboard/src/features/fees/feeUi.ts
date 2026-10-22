import type { FeeStatus } from '@haazir/shared'
import type { StatusTone } from '@/components/StatusPill'
import type { UiLanguage } from '@/lib/preferences'

/** Fee status as colour + icon + label (§14.2), the same everywhere it shows. */
export const FEE_TONE: Record<FeeStatus, StatusTone> = {
  upcoming: 'neutral',
  due: 'attention',
  overdue: 'danger',
  paid: 'success',
  waived: 'neutral',
}

/** "2026-10-24" → "24 Oct" / "24 अक्टू॰", a calendar date with no time zone maths. */
export function feeDate(iso: string, lang: UiLanguage) {
  return new Intl.DateTimeFormat(lang === 'hi' ? 'hi-IN' : 'en-IN', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T00:00:00Z`))
}
