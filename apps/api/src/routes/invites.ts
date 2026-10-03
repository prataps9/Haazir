import { Router } from 'express'
import { z } from 'zod'
import type { Auth } from '../auth/auth'
import { acceptInvite, describeInvite } from '../auth/invites'
import type { AppDeps } from '../deps'

const acceptBody = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  uiLanguage: z.enum(['hi', 'en']).optional(),
})

/** Public invite endpoints: see who invited you, set a password, get logged in. */
export function invitesRouter(deps: Pick<AppDeps, 'db' | 'now'> & { auth: Auth }) {
  const router = Router()

  router.get('/invites/:token', async (req, res) => {
    res.json(await describeInvite(deps.db, req.params.token, deps.now()))
  })

  router.post('/invites/:token/accept', async (req, res) => {
    const body = acceptBody.parse(req.body)
    const { email, orgId } = await acceptInvite(deps.db, req.params.token, body, deps.now())
    // Log them straight in: Better Auth sets the session cookie.
    const result = await deps.auth.api.signInEmail({
      body: { email, password: body.password },
      returnHeaders: true,
    })
    const cookies = result.headers.getSetCookie?.() ?? []
    if (cookies.length) res.setHeader('set-cookie', cookies)
    res.status(201).json({ orgId })
  })

  return router
}
