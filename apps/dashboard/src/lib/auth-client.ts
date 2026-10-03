import { createAuthClient } from 'better-auth/react'
import { API_BASE } from './api'

/** Better Auth's client: cookies, same routes as the API (/api/v1/auth). */
export const authClient = createAuthClient({
  baseURL: API_BASE || window.location.origin,
  basePath: '/api/v1/auth',
  fetchOptions: { credentials: 'include' },
})
