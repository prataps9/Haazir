import type { FeeStatus } from './constants'

/** A course's installment plan step (stored on `courses.installment_plan`). */
export interface PlanStep {
  label: string
  amountPaise: number
  /** Days after admission this installment falls due. */
  dueOffsetDays: number
}

/** Adds days to a calendar date ("2026-10-21" + 30 → "2026-11-20"). Pure date maths, no time zone. */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Whole days from `from` to `to` (both YYYY-MM-DD); negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

/** The installments a new student owes, from the course's plan and their admission date. */
export function scheduleInstallments(plan: PlanStep[], admissionDate: string) {
  return plan.map((step) => ({
    label: step.label,
    amountPaise: step.amountPaise,
    dueDate: addDays(admissionDate, step.dueOffsetDays),
  }))
}

/**
 * Where an unpaid installment stands on `today` (IST calendar date). Paid and
 * waived installments keep their status.
 */
export function feeStatusOn(
  installment: { dueDate: string; status: FeeStatus },
  today: string,
): FeeStatus {
  if (installment.status === 'paid' || installment.status === 'waived') return installment.status
  const days = daysBetween(today, installment.dueDate)
  if (days > 0) return 'upcoming'
  if (days === 0) return 'due'
  return 'overdue'
}

/** The plan's total must equal the course fee (spec §16.6: "Kishton ka total fees ke barabar"). */
export const planTotal = (plan: PlanStep[]) => plan.reduce((sum, s) => sum + s.amountPaise, 0)
