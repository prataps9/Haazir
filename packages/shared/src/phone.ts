/**
 * Phone numbers are stored as E.164 digits without the "+" (the form WhatsApp
 * uses for `wa_id`). People type them every other way, so this is the one
 * place that tidies them: spaces, dashes, brackets, a leading "+", "00" or
 * "0", a bare 10-digit Indian mobile number, and a number copied back out of
 * one of our own exports.
 *
 * Returns null when what's left can't be a phone number.
 */
export function normalisePhone(input: string, defaultCountryCode = '91'): string | null {
  // The apostrophe is what our own CSV exports put before "+", so Excel keeps it as text.
  let digits = input.replace(/[\s\-().']/g, '')
  const international = digits.startsWith('+') || digits.startsWith('00')
  digits = digits.replace(/^\+/, '').replace(/^00/, '')
  if (!/^\d+$/.test(digits)) return null
  if (!international) {
    // "09812345678" is how a mobile is dialled inside India.
    if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1)
    if (digits.length === 10) digits = `${defaultCountryCode}${digits}`
  }
  return digits.length >= 8 && digits.length <= 15 && !digits.startsWith('0') ? digits : null
}
