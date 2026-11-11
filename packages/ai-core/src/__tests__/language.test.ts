import { describe, expect, it } from 'vitest'
import { detectLanguage, detectScript } from '../language'

describe('detectScript / detectLanguage', () => {
  it.each([
    ['RS-CIT की फीस कितनी है?', 'devanagari', 'hi'],
    ['आरएससीआईटी कब से शुरू है', 'devanagari', 'hi'],
    ['RSCIT ki fees kitni hai bhaiya', 'latin', 'hinglish'],
    ['tally ka batch kab se hai', 'latin', 'hinglish'],
    ['kitni fees?', 'latin', 'hinglish'],
    ['What is the fee for Tally?', 'latin', 'en'],
    ['Tell me about the batch timings for the Python course', 'latin', 'en'],
    ['Hello', 'latin', 'en'],
  ] as const)('%s → %s / %s', (text, script, language) => {
    expect(detectScript(text)).toBe(script)
    expect(detectLanguage(text)).toBe(language)
  })
})

describe('allowedLanguage', () => {
  it('changes nothing when every language is allowed, or none is listed', async () => {
    const { allowedLanguage } = await import('../language')
    expect(allowedLanguage('hi', ['hi', 'en', 'hinglish'])).toBe('hi')
    expect(allowedLanguage('en', [])).toBe('en')
    expect(allowedLanguage('en', null)).toBe('en')
  })

  it('falls to the nearest allowed one: Hindi and Hinglish before English', async () => {
    const { allowedLanguage } = await import('../language')
    expect(allowedLanguage('hi', ['hinglish', 'en'])).toBe('hinglish')
    expect(allowedLanguage('hinglish', ['hi', 'en'])).toBe('hi')
    expect(allowedLanguage('en', ['hi', 'hinglish'])).toBe('hinglish')
    expect(allowedLanguage('en', ['hi'])).toBe('hi')
  })
})
