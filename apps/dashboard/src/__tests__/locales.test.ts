import { describe, expect, it } from 'vitest'
import en from '../locales/en.json'
import hi from '../locales/hi.json'

function keys(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  )
}

describe('locales', () => {
  it('hi and en have exactly the same keys', () => {
    expect(keys(hi).sort()).toEqual(keys(en).sort())
  })

  it('has no empty strings', () => {
    for (const [lang, obj] of Object.entries({ hi, en })) {
      const walk = (o: object, path: string) => {
        for (const [k, v] of Object.entries(o)) {
          if (typeof v === 'object') walk(v, `${path}${k}.`)
          else expect(String(v).trim(), `${lang}:${path}${k}`).not.toBe('')
        }
      }
      walk(obj, '')
    }
  })

  it('follows the microcopy rules (§14.8)', () => {
    for (const value of [...keys(hi).map((k) => get(hi, k)), ...keys(en).map((k) => get(en, k))]) {
      expect(value, 'no trailing arrows').not.toMatch(/[→›»]\s*$/)
      expect(value, 'no "A · B" meta strings').not.toMatch(/ · /)
      // STOP is the word people type to opt out, so it is quoted exactly as typed.
      const text = value.replace(/\bSTOP\b/g, '')
      expect(text === text.toUpperCase() && /[A-Z]{4,}/.test(text), `no all-caps: ${value}`).toBe(
        false,
      )
    }
  })
})

function get(obj: object, path: string): string {
  return path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], obj) as string
}
