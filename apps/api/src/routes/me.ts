import { Router } from 'express'
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { invites, memberships, organizations, users } from '@haazir/db'
import { ROLES } from '@haazir/shared'
import { createInvite } from '../auth/invites'
import { requireRole } from '../auth/middleware'
import type { AppDeps } from '../deps'
import { audit, orgOf, userOf } from '../lib/http'

/** Who am I, and which orgs can I act for. Needs a session, not an org. */
export function meRouter(deps: Pick<AppDeps, 'db'>) {
  const router = Router()

  router.get('/me', async (req, res) => {
    const user = userOf(req)
    const orgs = await deps.db
      .select({
        id: organizations.id,
        name: organizations.name,
        displayName: organizations.brand,
        city: organizations.city,
        role: memberships.role,
      })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.orgId))
      .where(eq(memberships.userId, user.id))
    res.json({
      user,
      orgs: orgs.map((o) => ({ ...o, displayName: o.displayName?.displayName ?? o.name })),
    })
  })

  router.patch('/me', async (req, res) => {
    const user = userOf(req)
    const body = z
      .object({
        name: z.string().trim().min(1).max(100).optional(),
        uiLanguage: z.enum(['hi', 'en']).optional(),
      })
      .parse(req.body)
    await deps.db.update(users).set(body).where(eq(users.id, user.id))
    res.json({ ok: true })
  })

  return router
}

/** Org members and staff invites (the full Team screen is Phase 6). */
export function membersRouter(deps: Pick<AppDeps, 'db' | 'appUrl' | 'now'>) {
  const router = Router()

  router.get('/members', async (req, res) => {
    const org = orgOf(req)
    const rows = await deps.db
      .select({
        id: memberships.id,
        userId: users.id,
        name: users.name,
        email: users.email,
        role: memberships.role,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.orgId, org.id))
    const pending = await deps.db
      .select({
        id: invites.id,
        email: invites.email,
        role: invites.role,
        expiresAt: invites.expiresAt,
      })
      .from(invites)
      .where(and(eq(invites.orgId, org.id), isNull(invites.acceptedAt)))
    res.json({ members: rows, invites: pending })
  })

  /** My own notification switches for this org (handoff push is on unless turned off). */
  router.get('/members/me/notifications', async (req, res) => {
    const [row] = await deps.db
      .select({ prefs: memberships.notifyPrefs })
      .from(memberships)
      .where(and(eq(memberships.orgId, orgOf(req).id), eq(memberships.userId, userOf(req).id)))
    res.json({ handoffPush: row?.prefs?.handoff?.push !== false })
  })

  router.patch('/members/me/notifications', async (req, res) => {
    const org = orgOf(req)
    const { handoffPush } = z.object({ handoffPush: z.boolean() }).parse(req.body)
    const where = and(eq(memberships.orgId, org.id), eq(memberships.userId, userOf(req).id))
    const [row] = await deps.db
      .select({ prefs: memberships.notifyPrefs })
      .from(memberships)
      .where(where)
    const handoff = { email: row?.prefs?.handoff?.email ?? false, push: handoffPush }
    await deps.db
      .update(memberships)
      .set({ notifyPrefs: { ...row?.prefs, handoff } })
      .where(where)
    res.json({ handoffPush })
  })

  router.post('/members', requireRole('owner', 'admin'), async (req, res) => {
    const org = orgOf(req)
    const body = z
      .object({
        email: z.email(),
        name: z.string().trim().max(100).optional(),
        // Only an owner can make another owner.
        role: z
          .enum(ROLES)
          .refine(
            (r) => r !== 'owner' || req.org?.role === 'owner',
            'Only an owner can invite an owner',
          ),
      })
      .parse(req.body)
    const { token } = await createInvite(deps.db, {
      orgId: org.id,
      email: body.email,
      name: body.name,
      role: body.role,
      invitedByUserId: req.user?.id,
      now: deps.now(),
    })
    await audit(deps.db, req, {
      action: 'member.invited',
      entity: 'invite',
      diff: { email: body.email, role: body.role },
    })
    // Email delivery arrives with Resend in Phase 6; for now the link is shown to copy.
    res.status(201).json({ inviteUrl: `${deps.appUrl}/invite/${token}` })
  })

  return router
}
