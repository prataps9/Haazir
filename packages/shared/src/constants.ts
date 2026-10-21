/** Values shared by the database schema, the API and the dashboard. */

export const ROLES = ['owner', 'admin', 'agent'] as const
export type Role = (typeof ROLES)[number]

export const VERTICALS = ['coaching', 'clinic', 'real_estate', 'retail', 'hotel', 'other'] as const
export type Vertical = (typeof VERTICALS)[number]

export const LANGUAGES = ['hi', 'en', 'hinglish'] as const
export type Language = (typeof LANGUAGES)[number]

export const ORG_STATUSES = ['onboarding', 'active', 'paused', 'cancelled'] as const
export type OrgStatus = (typeof ORG_STATUSES)[number]

export const DEFAULT_TIMEZONE = 'Asia/Kolkata'

// Coaching vertical (spec §8). The order of LEAD_STAGES is the Kanban's column order.
export const LEAD_STAGES = [
  'new',
  'contacted',
  'demo_booked',
  'demo_done',
  'admitted',
  'lost',
] as const
export type LeadStage = (typeof LEAD_STAGES)[number]

export const LEAD_SOURCES = ['whatsapp', 'ad', 'walkin', 'referral', 'campaign', 'other'] as const
export type LeadSource = (typeof LEAD_SOURCES)[number]

/** The chips shown when a lead is moved to Lost (spec §16.5). */
export const LOST_REASONS = [
  'fees_high',
  'too_far',
  'joined_elsewhere',
  'no_reply',
  'other',
] as const
export type LostReason = (typeof LOST_REASONS)[number]

export const DEMO_STATUSES = ['booked', 'reminded', 'attended', 'no_show', 'cancelled'] as const
export type DemoStatus = (typeof DEMO_STATUSES)[number]

export const STUDENT_STATUSES = ['active', 'completed', 'dropped'] as const
export type StudentStatus = (typeof STUDENT_STATUSES)[number]

export const FEE_STATUSES = ['upcoming', 'due', 'overdue', 'paid', 'waived'] as const
export type FeeStatus = (typeof FEE_STATUSES)[number]

export const PAID_VIA = ['razorpay', 'cash', 'upi_manual', 'bank'] as const
export type PaidVia = (typeof PAID_VIA)[number]

export const TEMPLATE_CATEGORIES = ['utility', 'marketing', 'authentication'] as const
export const TEMPLATE_STATUSES = ['draft', 'pending', 'approved', 'rejected', 'paused'] as const
export const TEMPLATE_PURPOSES = [
  'demo_confirm',
  'demo_reminder',
  'fee_upcoming',
  'fee_due',
  'fee_overdue',
  'payment_received',
  'daily_summary',
  'followup',
  'announcement',
  'custom',
] as const
export type TemplatePurpose = (typeof TEMPLATE_PURPOSES)[number]

/** Shape of `plans.limits`. The values live in the database, editable by super admin. */
export interface PlanLimits {
  seats: number
  numbers: number
  aiReplies: number
  /** Campaigns per month. `null` means no cap. */
  campaigns: number | null
  features: string[]
}

/** Per-weekday opening hours, `HH:mm` 24-hour. `null` means closed that day. */
export type BusinessHours = Record<
  'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun',
  { open: string; close: string } | null
>
