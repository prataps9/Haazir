import { Router } from 'express'
import { count, desc, eq, max, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  botConfigs,
  conversations,
  memberships,
  organizations,
  plans,
  whatsappAccounts,
} from '@haazir/db'
import { encryptSecret } from '@haazir/shared/crypto'
import { AppError } from '@haazir/shared'
import { GraphError } from '@haazir/whatsapp'
import { createInvite } from '../auth/invites'
import type { AppDeps } from '../deps'
import { audit, uuidParam } from '../lib/http'

const accountView = {
  id: whatsappAccounts.id,
  wabaId: whatsappAccounts.wabaId,
  phoneNumberId: whatsappAccounts.phoneNumberId,
  displayPhone: whatsappAccounts.displayPhone,
  verifiedName: whatsappAccounts.verifiedName,
  qualityRating: whatsappAccounts.qualityRating,
  status: whatsappAccounts.status,
  lastError: whatsappAccounts.lastError,
  updatedAt: whatsappAccounts.updatedAt,
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50)

/**
 * Super admin (spec §16.16; the full screen is Phase 6). Phase 3 needs:
 * create an org with an owner invite, and connect its WhatsApp number by hand.
 */
export function adminRouter(
  deps: Pick<AppDeps, 'db' | 'appUrl' | 'graph' | 'encryptionKey' | 'now'>,
) {
  const { db } = deps
  const router = Router()

  router.get('/admin/orgs', async (_req, res) => {
    const rows = await db
      .select({
        id: organizations.id,
        name: organizations.name,
        city: organizations.city,
        status: organizations.status,
        plan: plans.name,
        createdAt: organizations.createdAt,
        members: sql<number>`(select count(*)::int from ${memberships} where ${memberships.orgId} = ${organizations.id})`,
        whatsappStatus: sql<
          string | null
        >`(select ${whatsappAccounts.status} from ${whatsappAccounts} where ${whatsappAccounts.orgId} = ${organizations.id} limit 1)`,
        lastActivity: sql<Date | null>`(select max(${conversations.lastMessageAt}) from ${conversations} where ${conversations.orgId} = ${organizations.id})`,
      })
      .from(organizations)
      .leftJoin(plans, eq(plans.id, organizations.planId))
      .orderBy(desc(organizations.createdAt))
    res.json({ orgs: rows })
  })

  router.post('/admin/orgs', async (req, res) => {
    const body = z
      .object({
        name: z.string().trim().min(2).max(120),
        city: z.string().trim().min(2).max(60),
        planCode: z.string().default('growth'),
        ownerName: z.string().trim().min(1).max(100),
        ownerEmail: z.email(),
      })
      .parse(req.body)
    const [plan] = await db.select().from(plans).where(eq(plans.code, body.planCode))
    if (!plan) throw new AppError('VALIDATION', `No plan "${body.planCode}"`)

    let slug = slugify(`${body.name} ${body.city}`)
    const [taken] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, slug))
    if (taken) slug = `${slug}-${Date.now().toString(36).slice(-4)}`

    const [org] = await db
      .insert(organizations)
      .values({
        name: body.name,
        city: body.city,
        slug,
        planId: plan.id,
        status: 'onboarding',
        vertical: 'coaching',
      })
      .returning()
    await db
      .insert(botConfigs)
      .values({ orgId: org!.id, optoutKeywords: ['stop', 'unsubscribe', 'band karo', 'मत भेजो'] })
    const { token } = await createInvite(db, {
      orgId: org!.id,
      email: body.ownerEmail,
      name: body.ownerName,
      role: 'owner',
      invitedByUserId: req.user?.id,
      now: deps.now(),
    })
    await audit(db, req, {
      orgId: org!.id,
      action: 'org.created',
      entity: 'organization',
      entityId: org!.id,
      diff: { name: body.name, ownerEmail: body.ownerEmail },
    })
    res.status(201).json({ org, inviteUrl: `${deps.appUrl}/invite/${token}` })
  })

  router.get('/admin/orgs/:id', async (req, res) => {
    const { id } = uuidParam.parse(req.params)
    const [org] = await db.select().from(organizations).where(eq(organizations.id, id))
    if (!org) throw new AppError('NOT_FOUND', 'Organisation not found')
    const accounts = await db
      .select(accountView)
      .from(whatsappAccounts)
      .where(eq(whatsappAccounts.orgId, id))
    const [stats] = await db
      .select({ conversations: count(), lastActivity: max(conversations.lastMessageAt) })
      .from(conversations)
      .where(eq(conversations.orgId, id))
    res.json({ org, whatsappAccounts: accounts, stats })
  })

  /** Manual connect (spec §10): WABA id, phone number id and a system-user token. */
  router.post('/admin/orgs/:id/whatsapp', async (req, res) => {
    const { id } = uuidParam.parse(req.params)
    const body = z
      .object({
        wabaId: z
          .string()
          .trim()
          .regex(/^\d{5,20}$/, 'WABA id is digits only'),
        phoneNumberId: z
          .string()
          .trim()
          .regex(/^\d{5,20}$/, 'Phone number id is digits only'),
        accessToken: z.string().trim().min(20, 'That token looks too short'),
      })
      .parse(req.body)
    if (!deps.encryptionKey)
      throw new AppError('UNAVAILABLE', 'ENCRYPTION_KEY is not set on the server')
    const [org] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, id))
    if (!org) throw new AppError('NOT_FOUND', 'Organisation not found')
    const [taken] = await db
      .select()
      .from(whatsappAccounts)
      .where(eq(whatsappAccounts.phoneNumberId, body.phoneNumberId))
    if (taken && taken.orgId !== id)
      throw new AppError('VALIDATION', 'That number is connected to another organisation')

    await db
      .insert(whatsappAccounts)
      .values({
        orgId: id,
        wabaId: body.wabaId,
        phoneNumberId: body.phoneNumberId,
        accessTokenEnc: encryptSecret(body.accessToken, deps.encryptionKey),
      })
      .onConflictDoUpdate({
        target: whatsappAccounts.phoneNumberId,
        set: {
          wabaId: body.wabaId,
          accessTokenEnc: encryptSecret(body.accessToken, deps.encryptionKey),
          status: 'connected',
          lastError: null,
        },
      })
    await audit(db, req, {
      orgId: id,
      action: 'whatsapp.connected',
      entity: 'whatsapp_account',
      entityId: body.phoneNumberId,
    })
    const [account] = await db
      .select(accountView)
      .from(whatsappAccounts)
      .where(eq(whatsappAccounts.phoneNumberId, body.phoneNumberId))
    res.status(201).json(account)
  })

  /**
   * "Test connection": asks Meta about the number with the stored token. Reads
   * only, so it can't message anyone by mistake, and it fills in the display
   * number, verified name and quality rating.
   */
  router.post('/admin/orgs/:id/whatsapp/:accountId/test', async (req, res) => {
    const { id } = uuidParam.parse(req.params)
    const accountId = z.uuid().parse(req.params.accountId)
    const [account] = await db
      .select()
      .from(whatsappAccounts)
      .where(eq(whatsappAccounts.id, accountId))
    if (!account || account.orgId !== id) throw new AppError('NOT_FOUND', 'Number not found')
    try {
      const info = await deps.graph(account).getPhoneNumber()
      await db
        .update(whatsappAccounts)
        .set({
          displayPhone: info.displayPhone,
          verifiedName: info.verifiedName,
          qualityRating: info.qualityRating,
          status: 'connected',
          lastError: null,
        })
        .where(eq(whatsappAccounts.id, accountId))
      res.json({ ok: true, ...info })
    } catch (err) {
      const message = err instanceof GraphError ? err.message : (err as Error).message
      await db
        .update(whatsappAccounts)
        .set({ status: 'error', lastError: message })
        .where(eq(whatsappAccounts.id, accountId))
      res.status(200).json({ ok: false, error: message })
    }
  })

  return router
}
