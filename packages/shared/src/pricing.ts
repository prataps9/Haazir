/**
 * What WhatsApp messages cost (spec §10, "Cost estimate"). Meta charges the
 * institute's WhatsApp account per delivered template message, by category;
 * GST (18%) is added on top. Haazir only estimates and reports these: the
 * bill is Meta's.
 *
 * Rates are in centipaise (1/100 paise) because Meta's India rates have four
 * decimals (₹0.8631 = 8631). Totals are rounded to whole paise once, at the end.
 */
export const PRICING_CATEGORIES = ['marketing', 'utility', 'authentication', 'service'] as const
export type PricingCategory = (typeof PRICING_CATEGORIES)[number]

export type Rates = Record<PricingCategory, number>

/**
 * Meta's India (+91) rate card as published for 2026. Seeded into
 * `meta_rates` and used when the table has no row for a category. The super
 * admin keeps the table current (Meta changes rates with notice).
 */
export const DEFAULT_META_RATES_IN: Rates = {
  marketing: 8631,
  utility: 1150,
  authentication: 1150,
  service: 0,
}

export const GST_RATE = 0.18

/** `count` messages at `rateCentipaise` each, in whole paise. */
export function costPaise(count: number, rateCentipaise: number): number {
  return Math.round((count * rateCentipaise) / 100)
}

export function gstPaise(paise: number): number {
  return Math.round(paise * GST_RATE)
}

/** Meta's category names in webhooks are lower case, but be forgiving. */
export function pricingCategoryOf(value: string | null | undefined): PricingCategory | null {
  const v = value?.toLowerCase()
  if (v === 'authentication_international') return 'authentication'
  if (v === 'referral_conversion') return 'service'
  return (PRICING_CATEGORIES as readonly string[]).includes(v ?? '') ? (v as PricingCategory) : null
}
