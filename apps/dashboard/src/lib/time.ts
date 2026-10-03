import type { UiLanguage } from './preferences'

const TZ = 'Asia/Kolkata'
const locale = (lang: UiLanguage) => (lang === 'hi' ? 'hi-IN' : 'en-IN')

const dayKey = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d)

/** "11:40 PM", in IST whatever the phone's timezone. */
export function clock(iso: string, lang: UiLanguage) {
  return new Intl.DateTimeFormat(locale(lang), {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: TZ,
  }).format(new Date(iso))
}

/** For the chat list: time today, "Kal" yesterday, else a short date. */
export function listTime(iso: string | null, lang: UiLanguage, now = new Date()) {
  if (!iso) return ''
  const d = new Date(iso)
  if (dayKey(d) === dayKey(now)) return clock(iso, lang)
  if (dayKey(d) === dayKey(new Date(now.getTime() - 86_400_000)))
    return lang === 'hi' ? 'कल' : 'Yesterday'
  return new Intl.DateTimeFormat(locale(lang), {
    day: 'numeric',
    month: 'short',
    timeZone: TZ,
  }).format(d)
}

/** Day separators: "Aaj", "Kal", or "मंगलवार, 6 अक्टूबर". */
export function dayLabel(iso: string, lang: UiLanguage, now = new Date()) {
  const d = new Date(iso)
  if (dayKey(d) === dayKey(now)) return lang === 'hi' ? 'आज' : 'Today'
  if (dayKey(d) === dayKey(new Date(now.getTime() - 86_400_000)))
    return lang === 'hi' ? 'कल' : 'Yesterday'
  return new Intl.DateTimeFormat(locale(lang), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: TZ,
  }).format(d)
}

export const sameDay = (a: string, b: string) => dayKey(new Date(a)) === dayKey(new Date(b))

/** Whole hours (or minutes, under an hour) left in the 24h window; null if closed. */
export function windowLeft(expiresAt: string | null, now = new Date()) {
  if (!expiresAt) return null
  const ms = new Date(expiresAt).getTime() - now.getTime()
  if (ms <= 0) return null
  return ms >= 3_600_000
    ? { hours: Math.floor(ms / 3_600_000) }
    : { minutes: Math.max(1, Math.floor(ms / 60_000)) }
}
