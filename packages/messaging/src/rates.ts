import { and, desc, eq, lte } from 'drizzle-orm'
import { metaRates, type AnyDatabase } from '@haazir/db'
import { DEFAULT_META_RATES_IN, PRICING_CATEGORIES, type Rates } from '@haazir/shared'

/**
 * Meta's rates in force on a day (YYYY-MM-DD): per category, the latest row
 * that started on or before it, else the built-in India card.
 */
export async function ratesOn(db: AnyDatabase, day: string, country = 'IN'): Promise<Rates> {
  const rows = await db
    .select()
    .from(metaRates)
    .where(and(eq(metaRates.country, country), lte(metaRates.effectiveFrom, day)))
    .orderBy(desc(metaRates.effectiveFrom))
  const rates = { ...DEFAULT_META_RATES_IN }
  for (const category of PRICING_CATEGORIES) {
    const row = rows.find((r) => r.category === category)
    if (row) rates[category] = row.priceCentipaise
  }
  return rates
}
