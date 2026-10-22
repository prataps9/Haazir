import { Router } from 'express'
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { invites, memberships, organizations, users } from '@haazir/db'
import { AppError, ROLES } from '@haazir/shared'
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

  /**
   * My own notification switches for this org: handoff push (on unless turned
   * off) and, for owners and admins, the 8 PM summary on WhatsApp to my number.
   */
  router.get('/members/me/notifications', async (req, res) => {
    const [row] = await deps.db
      .select({ prefs: memberships.notifyPrefs, role: memberships.role, phone: users.phone })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.orgId, orgOf(req).id), eq(memberships.userId, userOf(req).id)))
    res.json({
      handoffPush: row?.prefs?.handoff?.push !== false,
      dailySummary: !!row?.prefs?.dailySummary,
      phone: row?.phone ?? null,
      canDailySummary: row?.role === 'owner' || row?.role === 'admin',
    })
  })

  router.patch('/members/me/notifications', async (req, res) => {
    const org = orgOf(req)
    const body = z
      .object({
        handoffPush: z.boolean().optional(),
        dailySummary: z.boolean().optional(),
        // An Indian mobile (10 digits) or a full number with country code; stored E.164 without "+".
        phone: z
          .string()
          .trim()
          .transform((p) => p.replace(/[\s()+-]/g, ''))
          .pipe(z.string().regex(/^(\d{10}|\d{11,15})$/, 'Enter a WhatsApp number'))
          .transform((p) => (p.length === 10 ? `91${p}` : p))
          .nullable()
          .optional(),
      })
      .parse(req.body)
    const where = and(eq(memberships.orgId, org.id), eq(memberships.userId, userOf(req).id))
    const [row] = await deps.db
      .select({ prefs: memberships.notifyPrefs, role: memberships.role })
      .from(memberships)
      .where(where)
    if (body.dailySummary && row?.role !== 'owner' && row?.role !== 'admin')
      throw new AppError('FORBIDDEN', 'The daily summary is for owners and admins')
    const prefs = { ...row?.prefs }
    if (body.handoffPush !== undefined)
      prefs.handoff = { email: prefs.handoff?.email ?? false, push: body.handoffPush }
    if (body.dailySummary !== undefined) prefs.dailySummary = body.dailySummary
    await deps.db.update(memberships).set({ notifyPrefs: prefs }).where(where)
    if (body.phone !== undefined)
      await deps.db
        .update(users)
        .set({ phone: body.phone })
        .where(eq(users.id, userOf(req).id))
    const [me] = await deps.db
      .select({ phone: users.phone })
      .from(users)
      .where(eq(users.id, userOf(req).id))
    res.json({
      handoffPush: prefs.handoff?.push !== false,
      dailySummary: !!prefs.dailySummary,
      phone: me?.phone ?? null,
      canDailySummary: row?.role === 'owner' || row?.role === 'admin',
    })
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
