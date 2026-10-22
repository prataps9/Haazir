import { Router } from 'express'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { campaignRecipients, campaigns, contacts, templates } from '@haazir/db'
import {
  audienceCount,
  audienceWhere,
  campaignPreview,
  campaignResults,
  campaignStats,
  campaignValues,
  connectedAccount,
  estimateCost,
  recipientContext,
  quietUntil,
  type Campaign,
  type Template,
} from '@haazir/messaging'
import {
  AppError,
  CAMPAIGN_VARIABLE_SOURCES,
  LEAD_STAGES,
  partsOf,
  variableCount,
  type CampaignAudience,
} from '@haazir/shared'
import { requireRole } from '../auth/middleware'
import type { AppDeps } from '../deps'
import { audit, orgOf, userOf, uuidParam } from '../lib/http'

const audience = z
  .object({
    tags: z.array(z.string().trim().min(1).max(30)).max(20).optional(),
    stages: z.array(z.enum(LEAD_STAGES)).max(LEAD_STAGES.length).optional(),
    courseIds: z.array(z.uuid()).max(50).optional(),
    batchIds: z.array(z.uuid()).max(100).optional(),
  })
  .strict()

const variableMap = z
  .array(
    z.object({
      source: z.enum(CAMPAIGN_VARIABLE_SOURCES),
      text: z.string().trim().max(200).optional(),
    }),
  )
  .max(20)

const draftBody = z.object({
  name: z.string().trim().min(1).max(80),
  templateId: z.uuid().nullable().optional(),
  audience: audience.optional(),
  variableMap: variableMap.optional(),
})

/** Meta's messaging limit tiers: how many people a number may start chats with per day. */
const TIER_LIMITS: Record<string, number> = {
  TIER_50: 50,
  TIER_250: 250,
  TIER_1K: 1000,
  TIER_10K: 10_000,
  TIER_100K: 100_000,
}

/**
 * Campaigns (spec §16.8): draft, live audience count, preview for one real
 * person, cost estimate, send now or schedule, cancel, results.
 */
export function campaignsRouter(deps: Pick<AppDeps, 'db' | 'queues' | 'events' | 'now'>) {
  const { db } = deps
  const router = Router()
  // Spec §19: agents chat, follow up leads and take fees; campaigns are for owners and admins.
  router.use('/campaigns', requireRole('owner', 'admin'))

  const load = async (orgId: string, id: string) => {
    const [row] = await db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, id), eq(campaigns.orgId, orgId)))
    if (!row) throw new AppError('NOT_FOUND', 'Campaign not found')
    return row
  }
  const templateOf = async (orgId: string, templateId: string | null) => {
    if (!templateId) return undefined
    const [t] = await db
      .select()
      .from(templates)
      .where(and(eq(templates.id, templateId), eq(templates.orgId, orgId)))
    return t
  }
  const draftOnly = (c: Campaign) => {
    if (c.status !== 'draft')
      throw new AppError('VALIDATION', 'This campaign has already been scheduled', {
        reason: 'not_draft',
      })
  }

  const view = (c: Campaign, t?: Template) => ({
    id: c.id,
    name: c.name,
    status: c.status,
    audience: c.audience,
    variableMap: c.variableMap,
    scheduledAt: c.scheduledAt,
    startedAt: c.startedAt,
    finishedAt: c.finishedAt,
    estimatedRecipients: c.estimatedRecipients,
    estimatedCostPaise: c.estimatedCostPaise,
    createdAt: c.createdAt,
    template: t
      ? {
          id: t.id,
          name: t.name,
          language: t.language,
          category: t.category,
          status: t.status,
          variableCount: variableCount(partsOf(t.components).body),
          ...partsOf(t.components),
        }
      : null,
  })

  router.get('/campaigns', async (req, res) => {
    const org = orgOf(req)
    const rows = await db
      .select({ campaign: campaigns, template: templates })
      .from(campaigns)
      .leftJoin(templates, eq(templates.id, campaigns.templateId))
      .where(eq(campaigns.orgId, org.id))
      .orderBy(desc(campaigns.createdAt))
      .limit(100)
    const stats = await campaignStats(
      db,
      org.id,
      rows.filter((r) => r.campaign.status !== 'draft').map((r) => r.campaign.id),
    )
    const list = rows.map(({ campaign, template }) => ({
      ...view(campaign, template ?? undefined),
      stats: stats.get(campaign.id) ?? null,
    }))
    res.json({ campaigns: list })
  })

  router.get('/campaigns/:id', async (req, res) => {
    const org = orgOf(req)
    const { id } = uuidParam.parse(req.params)
    const c = await load(org.id, id)
    const t = await templateOf(org.id, c.templateId)
    res.json({
      ...view(c, t),
      results: c.status === 'draft' ? null : await campaignResults(db, c, t),
    })
  })

  router.post('/campaigns', async (req, res) => {
    const org = orgOf(req)
    const body = draftBody.parse(req.body)
    if (body.templateId && !(await templateOf(org.id, body.templateId)))
      throw new AppError('NOT_FOUND', 'Template not found')
    const [row] = await db
      .insert(campaigns)
      .values({
        orgId: org.id,
        name: body.name,
        templateId: body.templateId ?? null,
        audience: body.audience ?? {},
        variableMap: body.variableMap ?? [],
        createdByUserId: userOf(req).id,
      })
      .returning()
    res.status(201).json(view(row!, await templateOf(org.id, row!.templateId)))
  })

  router.patch('/campaigns/:id', async (req, res) => {
    const org = orgOf(req)
    const { id } = uuidParam.parse(req.params)
    const body = draftBody.partial().parse(req.body)
    draftOnly(await load(org.id, id))
    if (body.templateId && !(await templateOf(org.id, body.templateId)))
      throw new AppError('NOT_FOUND', 'Template not found')
    const [row] = await db
      .update(campaigns)
      .set(body)
      .where(and(eq(campaigns.id, id), eq(campaigns.orgId, org.id)))
      .returning()
    res.json(view(row!, await templateOf(org.id, row!.templateId)))
  })

  router.delete('/campaigns/:id', async (req, res) => {
    const org = orgOf(req)
    const { id } = uuidParam.parse(req.params)
    draftOnly(await load(org.id, id))
    await db.delete(campaigns).where(and(eq(campaigns.id, id), eq(campaigns.orgId, org.id)))
    res.status(204).end()
  })

  /** The builder's live count (spec §16.8): opted-in only, and how many that leaves out. */
  router.post('/campaigns/audience-count', async (req, res) => {
    const org = orgOf(req)
    const body = z.object({ audience }).parse(req.body)
    res.json(await audienceCount(db, org.id, body.audience))
  })

  /** "~₹186 + GST, marketing category", and whether the number's daily limit covers it. */
  router.post('/campaigns/:id/estimate', async (req, res) => {
    const org = orgOf(req)
    const { id } = uuidParam.parse(req.params)
    const c = await load(org.id, id)
    const t = await templateOf(org.id, c.templateId)
    if (!t) throw new AppError('VALIDATION', 'Pick a template first', { reason: 'no_template' })
    const count = await audienceCount(db, org.id, c.audience)
    const estimate = await estimateCost(db, {
      recipients: count.count,
      category: t.category,
      on: deps.now(),
    })
    const account = await connectedAccount(db, org.id)
    const tierLimit = account?.messagingLimitTier
      ? (TIER_LIMITS[account.messagingLimitTier] ?? null)
      : null
    res.json({ ...count, ...estimate, tierLimit })
  })

  /** One real person's message, exactly as they'd read it. */
  router.get('/campaigns/:id/preview', async (req, res) => {
    const org = orgOf(req)
    const { id } = uuidParam.parse(req.params)
    const { contactId } = z.object({ contactId: z.uuid().optional() }).parse(req.query)
    const c = await load(org.id, id)
    const t = await templateOf(org.id, c.templateId)
    if (!t) throw new AppError('VALIDATION', 'Pick a template first', { reason: 'no_template' })
    const [who] = await db
      .select({ id: contacts.id, waId: contacts.waId, ...recipientContext })
      .from(contacts)
      .where(
        and(audienceWhere(org.id, c.audience), contactId ? eq(contacts.id, contactId) : undefined),
      )
      .orderBy(asc(contacts.createdAt))
      .limit(1)
    const values = campaignValues(c.variableMap, who ?? { name: null, course: null, batch: null })
    res.json({
      contact: who ? { id: who.id, name: who.name, waId: who.waId } : null,
      text: campaignPreview(t, values),
      ...partsOf(t.components),
    })
  })

  /** Send now (no `at`) or later. Freezes the estimate so results compare like with like. */
  router.post('/campaigns/:id/schedule', async (req, res) => {
    const org = orgOf(req)
    const { id } = uuidParam.parse(req.params)
    const now = deps.now()
    const { at } = z
      .object({
        at: z.iso
          .datetime({ offset: true })
          .transform((s) => new Date(s))
          .refine(
            (d) => d.getTime() <= now.getTime() + 30 * 86_400_000,
            'Schedule within the next 30 days',
          )
          .optional(),
      })
      .parse(req.body ?? {})
    const c = await load(org.id, id)
    draftOnly(c)
    const t = await templateOf(org.id, c.templateId)
    if (!t) throw new AppError('VALIDATION', 'Pick a template first', { reason: 'no_template' })
    if (t.status !== 'approved')
      throw new AppError('TEMPLATE_NOT_APPROVED', 'Only an approved template can be sent')
    const needed = variableCount(partsOf(t.components).body)
    const map = c.variableMap.slice(0, needed)
    if (map.length < needed || map.some((v) => v.source === 'custom' && !v.text?.trim()))
      throw new AppError('VALIDATION', 'Fill in every {{n}} of the template', {
        reason: 'variables_missing',
      })
    if (!(await connectedAccount(db, org.id)))
      throw new AppError('VALIDATION', 'Connect a WhatsApp number first', { reason: 'no_number' })
    const count = await audienceCount(db, org.id, c.audience)
    if (!count.count)
      throw new AppError('VALIDATION', 'Nobody in this audience has said yes to messages', {
        reason: 'empty_audience',
      })
    const estimate = await estimateCost(db, {
      recipients: count.count,
      category: t.category,
      on: now,
    })
    // Campaigns don't go out at night (9 PM to 8 AM IST): say when it really starts.
    const asked = at && at > now ? at : now
    const when = quietUntil(asked) ?? asked

    const [row] = await db
      .update(campaigns)
      .set({
        status: 'scheduled',
        scheduledAt: when,
        variableMap: map,
        estimatedRecipients: count.count,
        estimatedCostPaise: estimate.costPaise,
      })
      .where(and(eq(campaigns.id, id), eq(campaigns.orgId, org.id), eq(campaigns.status, 'draft')))
      .returning()
    if (!row) throw new AppError('VALIDATION', 'This campaign has already been scheduled')
    await deps.queues.campaign.add(
      'start',
      { orgId: org.id, campaignId: id },
      { jobId: `campaign-${id}-start`, delay: Math.max(0, when.getTime() - now.getTime()) },
    )
    await audit(db, req, {
      action: 'campaign.scheduled',
      entity: 'campaign',
      entityId: id,
      diff: { recipients: count.count, at: when.toISOString(), costPaise: estimate.costPaise },
    })
    deps.events.emit(org.id, 'campaign:updated', { campaignId: id })
    res.json(view(row, t))
  })

  /** Stops a scheduled or sending campaign; whoever hasn't been sent to yet won't be. */
  router.post('/campaigns/:id/cancel', async (req, res) => {
    const org = orgOf(req)
    const { id } = uuidParam.parse(req.params)
    const [row] = await db
      .update(campaigns)
      .set({ status: 'cancelled', finishedAt: deps.now() })
      .where(
        and(
          eq(campaigns.id, id),
          eq(campaigns.orgId, org.id),
          inArray(campaigns.status, ['scheduled', 'sending']),
        ),
      )
      .returning()
    if (!row) {
      await load(org.id, id)
      throw new AppError('VALIDATION', 'Only a scheduled or sending campaign can be stopped', {
        reason: 'not_running',
      })
    }
    await db
      .update(campaignRecipients)
      .set({ status: 'skipped', errorCode: 'cancelled' })
      .where(
        and(
          eq(campaignRecipients.campaignId, id),
          eq(campaignRecipients.orgId, org.id),
          eq(campaignRecipients.status, 'pending'),
        ),
      )
    await audit(db, req, { action: 'campaign.cancelled', entity: 'campaign', entityId: id })
    deps.events.emit(org.id, 'campaign:updated', { campaignId: id })
    res.json(view(row, await templateOf(org.id, row.templateId)))
  })

  return router
}

export type { CampaignAudience }
