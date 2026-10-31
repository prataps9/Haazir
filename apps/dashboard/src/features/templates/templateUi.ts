import type { TFunction } from 'i18next'
import { DEFAULT_META_RATES_IN, type TemplateCategory, type TemplateStatus } from '@haazir/shared'
import type { StatusTone } from '@/components/StatusPill'
import { ApiError } from '@/lib/api'
import { errorText } from '@/lib/errors'

/** Status = icon + label + colour (§14): the pill's tone per review state. */
export const TEMPLATE_TONE: Record<TemplateStatus, StatusTone> = {
  draft: 'neutral',
  pending: 'attention',
  approved: 'success',
  rejected: 'danger',
  paused: 'danger',
}

/** "हिंदी" / "Hinglish" / "English": our Hinglish variants live under Meta's `en`. */
export function languageLabel(t: TFunction, name: string, language: string) {
  if (name.endsWith('_hinglish')) return t('templates.languages.hinglish')
  return language === 'hi' ? t('templates.languages.hi') : t('templates.languages.en')
}

/** ₹0.8631 → "₹0.86": Meta's per-message rate, as a person reads it. */
export function rupeesPerMessage(centipaise: number) {
  return `₹${(centipaise / 10_000).toFixed(2)}`
}

export const categoryRate = (category: TemplateCategory) =>
  rupeesPerMessage(DEFAULT_META_RATES_IN[category])

/**
 * What to say when the API refuses something about a template or campaign:
 * our own words for the reasons we know (Hindi or English), Meta's message
 * when Meta refused, else the usual fallback.
 */
export function growthError(err: unknown, t: TFunction) {
  if (err instanceof ApiError) {
    const d = err.details as { reason?: string; problems?: string[] } | undefined
    if (d?.problems?.length)
      return d.problems.map((p) => t(`templates.problems.${p}`, { defaultValue: p })).join(' ')
    if (d?.reason && d.reason !== 'meta_refused')
      return t(`growthErrors.${d.reason}`, { defaultValue: errorText(err, t('common.failed')) })
    if (err.code === 'TEMPLATE_NOT_APPROVED') return t('growthErrors.not_approved')
  }
  return errorText(err, t('common.failed'))
}
