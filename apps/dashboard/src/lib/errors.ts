import { ApiError } from './api'

/**
 * The server's message for a validation problem (it says what to fix), or a
 * plain fallback. Network and server errors never show raw text.
 */
export function errorText(err: unknown, fallback: string) {
  if (!(err instanceof ApiError)) return fallback
  if (err.code === 'VALIDATION') {
    // Zod's flattened shape: { formErrors: string[], fieldErrors: { field: string[] } }
    const d = err.details as
      { formErrors?: string[]; fieldErrors?: Record<string, string[]> } | undefined
    const first = d?.formErrors?.[0] ?? Object.values(d?.fieldErrors ?? {})[0]?.[0]
    return first ?? err.message
  }
  if (err.code === 'UNAVAILABLE') return err.message
  return fallback
}
