import { addDays, daysBetween } from '@haazir/shared'
import { formatDate } from '../facts'
import type { ReplyLanguage } from '../language'
import { DAY_WORD, WEEKDAY } from './copy'

const CODES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const
export type DayCode = (typeof CODES)[number]

/** Weekday of a calendar date ("2026-10-22" → "thu"). */
export function weekdayOf(date: string): DayCode {
  return CODES[new Date(`${date}T00:00:00Z`).getUTCDay()]!
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * How a day reads in a message or list row: "Kal (Guruvar)", "Shanivar, 24 Oct".
 * At most 24 characters (a WhatsApp list row).
 */
export function dayLabel(date: string, today: string, lang: ReplyLanguage): string {
  const offset = daysBetween(today, date)
  const weekday = WEEKDAY[lang][weekdayOf(date)]!
  const [, m, d] = date.split('-').map(Number)
  if (offset === 0) return `${DAY_WORD.today[lang]} (${weekday})`
  if (offset === 1) return `${DAY_WORD.tomorrow[lang]} (${weekday})`
  if (offset === 2 && lang !== 'en') return `${DAY_WORD.dayAfter[lang]} (${weekday})`
  return `${weekday}, ${d} ${MONTHS[m! - 1]}`
}

/** "Kal (Guruvar), 22 Oct 2026": the confirmation line, unambiguous. */
export function longDayLabel(date: string, today: string, lang: ReplyLanguage): string {
  const short = dayLabel(date, today, lang)
  return short.includes(',') ? `${short} ${date.slice(0, 4)}` : `${short}, ${formatDate(date)}`
}

const normalise = (s: string) => s.toLowerCase().normalize('NFC').trim()

const RELATIVE: [RegExp, number][] = [
  [/(^|\s)(aaj|aj|today|आज)(\s|$)/u, 0],
  [/(^|\s)(kal|kl|tomorrow|tmrw|कल)(\s|$)/u, 1],
  [/(^|\s)(parso|parson|parsoo|परसों|परसो|day after tomorrow)(\s|$)/u, 2],
]

/**
 * A day the person typed instead of tapping: "kal", "parso", "shanivar",
 * "saturday", "24 oct", "24". Returns the next matching date from today, or
 * null. "Kal" means tomorrow here: in a booking, nobody asks for yesterday.
 */
export function parseDay(text: string, today: string): string | null {
  const t = normalise(text)
  for (const [re, offset] of RELATIVE) if (re.test(t)) return addDays(today, offset)

  for (const lang of ['hinglish', 'hi', 'en'] as const) {
    for (const [code, name] of Object.entries(WEEKDAY[lang])) {
      const n = normalise(name)
      if (t.includes(n) || (lang === 'en' && new RegExp(`\\b${n.slice(0, 3)}\\b`).test(t))) {
        const start = CODES.indexOf(weekdayOf(today))
        const target = CODES.indexOf(code as DayCode)
        return addDays(today, (target - start + 7) % 7)
      }
    }
  }

  // "24", "24 oct", "24th": this month (or the named one), else the next one.
  const m = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?(?:\s+([a-z]{3,}))?\b/)
  if (m) {
    const day = Number(m[1])
    const [y, mo] = today.split('-').map(Number) as [number, number]
    const named = m[2] ? MONTHS.findIndex((x) => m[2]!.startsWith(x.toLowerCase())) : -1
    // "5 baje" is a time, not the 5th.
    if (m[2]?.startsWith('baj') || /\b(am|pm|o'?clock)\b/.test(t)) return null
    const iso = (year: number, month0: number) =>
      `${year + Math.floor(month0 / 12)}-${String((month0 % 12) + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const first = named >= 0 ? iso(y, named) : iso(y, mo - 1)
    const next = named >= 0 ? iso(y + 1, named) : iso(y, mo)
    for (const candidate of [first, next]) {
      if (isRealDate(candidate) && candidate >= today) return candidate
    }
  }
  return null
}

function isRealDate(date: string) {
  const d = new Date(`${date}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date
}
