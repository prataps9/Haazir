import { PaperPlaneTiltIcon, XCircleIcon, type Icon } from '@phosphor-icons/react'
import type { CampaignStatus } from '@haazir/shared'
import type { StatusTone } from '@/components/StatusPill'

/** Status = icon + label + colour (§14). */
export const CAMPAIGN_TONE: Record<CampaignStatus, { tone: StatusTone; icon?: Icon }> = {
  draft: { tone: 'neutral' },
  scheduled: { tone: 'attention' },
  sending: { tone: 'attention', icon: PaperPlaneTiltIcon },
  done: { tone: 'success' },
  cancelled: { tone: 'neutral', icon: XCircleIcon },
}

/**
 * Meta's error codes a campaign meets most, in words (keys under
 * campaigns.failures.*). Anything else shows Meta's own title.
 */
export const KNOWN_FAILURES = new Set([
  '131049', // per-person marketing limit ("healthy ecosystem")
  '131050', // they turned off marketing messages
  '131026', // not on WhatsApp / can't receive
  '131047', // outside the 24h window (shouldn't happen for templates)
  '132001', // template missing or not approved in that language
  '132015', // template paused
  '131048', // spam rate limit on the number
  'opted_out',
  'cancelled',
  'no_number',
])

/** "2026-10-24T11:00" in India time, for a datetime-local input. */
export function istLocalInput(d: Date) {
  return new Date(d.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 16)
}

/** A datetime-local value, read as India time, to an ISO instant. */
export function fromIstLocalInput(v: string) {
  return new Date(`${v}:00+05:30`).toISOString()
}
