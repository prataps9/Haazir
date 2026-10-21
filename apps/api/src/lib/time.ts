import { addDays } from '@haazir/shared'

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

/** The calendar date in India at this moment ("2026-10-21"). */
export const istDate = (d: Date) => new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10)

/** One IST calendar day (or several) as a UTC range [from, to). */
export function istRange(fromDate: string, days = 1) {
  return {
    from: new Date(`${fromDate}T00:00:00+05:30`),
    to: new Date(`${addDays(fromDate, days)}T00:00:00+05:30`),
  }
}

/** "2026-10" → the first day of that month and of the next, as IST dates. */
export function monthRange(month: string) {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const start = `${y}-${String(m).padStart(2, '0')}-01`
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
  return { start, next }
}
