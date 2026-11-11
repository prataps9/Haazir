import { describe, expect, it } from 'vitest'
import { normalisePhone } from '../phone'

describe('normalisePhone', () => {
  it('turns the ways people write an Indian mobile into E.164 digits', () => {
    for (const written of [
      '9812345678',
      '09812345678',
      '+91 98123 45678',
      '91-98123-45678',
      '0091 9812345678',
      '(+91) 98123 45678',
      "'+919812345678", // as our CSV export writes it
    ])
      expect(normalisePhone(written), written).toBe('919812345678')
  })

  it('keeps another country code when one is written', () => {
    expect(normalisePhone('+971 50 123 4567')).toBe('971501234567')
  })

  it('refuses what cannot be a phone number', () => {
    for (const bad of ['', 'abc', '12345', '98123x5678', '+0 123456789', '1234567890123456'])
      expect(normalisePhone(bad), bad).toBeNull()
  })
})
