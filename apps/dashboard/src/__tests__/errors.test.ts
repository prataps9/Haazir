import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api'
import { errorText } from '@/lib/errors'

describe('errorText', () => {
  it("shows the server's first validation message, so people know what to fix", () => {
    const err = new ApiError(400, 'VALIDATION', 'Some fields are invalid', {
      formErrors: [],
      fieldErrors: { phoneNumberId: ['Phone number id is digits only'] },
    })
    expect(errorText(err, 'fallback')).toBe('Phone number id is digits only')
  })

  it('shows a plain message for "not set up on the server" problems', () => {
    expect(errorText(new ApiError(503, 'UNAVAILABLE', 'ENCRYPTION_KEY is not set'), 'x')).toBe(
      'ENCRYPTION_KEY is not set',
    )
  })

  it('never leaks server or network error text', () => {
    expect(errorText(new ApiError(500, 'INTERNAL', 'select * from secrets'), 'Try again')).toBe(
      'Try again',
    )
    expect(errorText(new ApiError(0, 'NETWORK', 'Network request failed'), 'Try again')).toBe(
      'Try again',
    )
    expect(errorText(new Error('boom'), 'Try again')).toBe('Try again')
  })
})
