import type { ErrorBody, ErrorCode } from '@haazir/shared'
import { useSession } from './session-store'

// Dev goes through Vite's proxy (same origin); builds call the API directly.
export const API_BASE = import.meta.env.DEV ? '' : (import.meta.env.VITE_API_URL ?? '')
const BASE = API_BASE

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK',
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * Thin fetch wrapper. Every failure becomes an ApiError with a stable `code`,
 * so screens can branch on `WINDOW_CLOSED` or `PLAN_LIMIT` rather than text.
 */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const orgId = useSession.getState().orgId
  const isForm = typeof FormData !== 'undefined' && init.body instanceof FormData
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      credentials: 'include',
      ...init,
      headers: {
        ...(isForm ? {} : { 'content-type': 'application/json' }),
        // Which organisation this request acts for (checked server-side).
        ...(orgId ? { 'x-org-id': orgId } : {}),
        ...init.headers,
      },
    })
  } catch {
    throw new ApiError(0, 'NETWORK', 'Network request failed')
  }

  if (res.status === 204) return undefined as T
  const body = await res.json().catch(() => null)
  if (res.ok) return body as T

  const error = (body as ErrorBody | null)?.error
  throw new ApiError(
    res.status,
    error?.code ?? 'INTERNAL',
    error?.message ?? res.statusText,
    error?.details,
  )
}

export const post = <T>(path: string, body?: unknown) =>
  api<T>(path, {
    method: 'POST',
    body: body instanceof FormData ? body : JSON.stringify(body ?? {}),
  })
export const patch = <T>(path: string, body: unknown) =>
  api<T>(path, { method: 'PATCH', body: JSON.stringify(body) })
export const del = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: 'DELETE', ...(body ? { body: JSON.stringify(body) } : {}) })
