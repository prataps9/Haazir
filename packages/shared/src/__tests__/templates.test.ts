import { describe, expect, it } from 'vitest'
import { costPaise, gstPaise, pricingCategoryOf } from '../pricing'
import {
  componentsForMeta,
  componentsOf,
  DEFAULT_TEMPLATES,
  partsOf,
  templateParam,
  templateProblems,
  templateSlug,
  variableCount,
} from '../templates'

describe('the seeded templates', () => {
  it('all pass Meta’s rules, in every language', () => {
    for (const t of DEFAULT_TEMPLATES)
      for (const body of Object.values(t.body)) {
        expect(templateProblems({ body }), `${t.purpose}: ${body}`).toEqual([])
        expect(variableCount(body), t.purpose).toBe(t.variables.length)
      }
  })
})

describe('templateProblems', () => {
  it('catches what Meta rejects', () => {
    expect(templateProblems({ body: '{{1}} ji, namaste' })).toContain('variable_at_edge')
    expect(templateProblems({ body: 'Link: {{1}}' })).toContain('variable_at_edge')
    expect(templateProblems({ body: 'Hi {{1}} {{2}} there' })).toContain('variables_adjacent')
    expect(templateProblems({ body: 'Hi {{2}} there' })).toContain('variables_not_sequential')
    expect(templateProblems({ body: ' ' })).toContain('body_empty')
    expect(templateProblems({ body: 'ok', header: 'Hi {{1}}' })).toContain('header_invalid')
    expect(
      templateProblems({
        body: 'ok',
        buttons: [1, 2, 3, 4].map((n) => ({ type: 'QUICK_REPLY' as const, text: `b${n}` })),
      }),
    ).toContain('too_many_buttons')
  })
})

describe('components', () => {
  it('round-trips the parts people edit', () => {
    const parts = {
      header: 'Naya batch',
      body: 'Namaste {{1}}, {{2}} batch shuru!',
      footer: 'Reply STOP to opt out',
      buttons: [{ type: 'QUICK_REPLY' as const, text: 'Details' }],
    }
    expect(partsOf(componentsOf(parts))).toEqual(parts)
  })

  it('adds an example for every variable when submitting', () => {
    const [body] = componentsForMeta(
      [{ type: 'BODY', text: 'Hi {{1}}, {{2}} pending.' }],
      ['student_name', 'amount'],
    )
    expect(body).toMatchObject({ example: { body_text: [['Anil', '4,500']] } })
  })
})

describe('names and values', () => {
  it('slugs names the way Meta wants them', () => {
    expect(templateSlug('Diwali Offer 2026!')).toBe('diwali_offer_2026')
    expect(templateSlug('दिवाली ऑफर')).toBe('template')
  })

  it('flattens values Meta would reject', () => {
    expect(templateParam('Station Road,\n  Sikar')).toBe('Station Road, Sikar')
    expect(templateParam('   ')).toBe('-')
  })
})

describe('pricing', () => {
  it('rounds once, to paise', () => {
    // 50 marketing messages at ₹0.8631 = ₹43.155 → ₹43.16
    expect(costPaise(50, 8631)).toBe(4316)
    expect(gstPaise(4316)).toBe(777)
  })

  it('reads Meta’s category names', () => {
    expect(pricingCategoryOf('MARKETING')).toBe('marketing')
    expect(pricingCategoryOf('authentication_international')).toBe('authentication')
    expect(pricingCategoryOf('something_new')).toBeNull()
  })
})
