import { randomBytes } from 'node:crypto'
import { Router } from 'express'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { campaigns, templates } from '@haazir/db'
import { connectedAccount, submitTemplate, syncTemplates, type Template } from '@haazir/messaging'
import {
  AppError,
  componentsOf,
  partsOf,
  TEMPLATE_CATEGORIES,
  TEMPLATE_STATUSES,
  templateProblems,
  templateSlug,
  variableCount,
} from '@haazir/shared'
import { GraphError } from '@haazir/whatsapp'
import { requireRole } from '../auth/middleware'
import type { AppDeps } from '../deps'
import { audit, orgOf, uuidParam } from '../lib/http'

const button = z.discriminatedUnion('type', [
  z.object({ type: z.literal('QUICK_REPLY'), text: z.string().trim().min(1).max(25) }),
  z.object({
    type: z.literal('URL'),
    text: z.string().trim().min(1).max(25),
    url: z.url({ protocol: /^https$/, message: 'Use an https:// link' }).max(2000),
  }),
  z.object({
    type: z.literal('PHONE_NUMBER'),
    text: z.string().trim().min(1).max(25),
    phone_number: z.string().regex(/^\+?\d{8,15}$/, 'Phone number with country code'),
  }),
])

const partsBody = {
  header: z.string().trim().max(60).nullable().optional(),
  body: z.string().trim().min(1).max(1024),
  footer: z.string().trim().max(60).nullable().optional(),
  buttons: z.array(button).max(3).optional(),
  /** What each {{n}} is, e.g. ["contact_name", "batch"]; used for Meta's examples. */
  variables: z.array(z.string().trim().max(30)).max(20).optional(),
}

const createBody = z.object({
  name: z.string().trim().min(1).max(60),
  language: z.enum(['hi', 'en']),
  category: z.enum(['utility', 'marketing']),
  ...partsBody,
})

const patchBody = z.object({
  category: z.enum(['utility', 'marketing']).optional(),
  ...partsBody,
  body: partsBody.body.optional(),
})

/** What the Templates screen (spec §16.9) shows of one. */
function view(t: Template) {
  const parts = partsOf(t.components)
  return {
    id: t.id,
    name: t.name,
    language: t.language,
    category: t.category,
    status: t.status,
    rejectionReason: t.rejectionReason,
    purpose: t.purpose,
    variables: t.variables,
    variableCount: variableCount(parts.body),
    ...parts,
    problems: templateProblems(parts),
    submitted: !!t.metaTemplateId,
    updatedAt: t.updatedAt,
  }
}

/**
 * Templates (spec §16.9): list, edit drafts, "Meta ko bhejein", and sync.
 * Owners and admins only.
 */
export function templatesRouter(deps: Pick<AppDeps, 'db' | 'graph' | 'events'>) {
  const { db } = deps
  const router = Router()
  // Spec §19: templates are settings; owners and admins only.
  router.use('/templates', requireRole('owner', 'admin'))

  const load = async (orgId: string, id: string) => {
    const [row] = await db
      .select()
      .from(templates)
      .where(and(eq(templates.id, id), eq(templates.orgId, orgId)))
    if (!row) throw new AppError('NOT_FOUND', 'Template not found')
    return row
  }

  router.get('/templates', async (req, res) => {
    const org = orgOf(req)
    const { status } = z.object({ status: z.enum(TEMPLATE_STATUSES).optional() }).parse(req.query)
    const rows = await db
      .select()
      .from(templates)
      .where(and(eq(templates.orgId, org.id), status ? eq(templates.status, status) : undefined))
      .orderBy(asc(templates.purpose), asc(templates.name), asc(templates.language))
    const account = await connectedAccount(db, org.id)
    res.json({
      templates: rows.map(view),
      hasNumber: !!account,
      categories: TEMPLATE_CATEGORIES,
    })
  })

  router.get('/templates/:id', async (req, res) => {
    const { id } = uuidParam.parse(req.params)
    res.json(view(await load(orgOf(req).id, id)))
  })

  router.post('/templates', async (req, res) => {
    const org = orgOf(req)
    const body = createBody.parse(req.body)
    const name = metaName(body.name)
    const parts = {
      header: body.header || undefined,
      body: body.body,
      footer: body.footer || undefined,
      buttons: body.buttons,
    }
    const [row] = await db
      .insert(templates)
      .values({
        orgId: org.id,
        name,
        language: body.language,
        category: body.category,
        components: componentsOf(parts),
        variables: body.variables ?? [],
        purpose: 'custom',
      })
      .onConflictDoNothing()
      .returning()
    if (!row)
      throw new AppError('VALIDATION', 'A template with this name and language already exists', {
        reason: 'name_taken',
      })
    await audit(db, req, { action: 'template.created', entity: 'template', entityId: row.id })
    res.status(201).json(view(row))
  })

  router.patch('/templates/:id', async (req, res) => {
    const org = orgOf(req)
    const { id } = uuidParam.parse(req.params)
    const body = patchBody.parse(req.body)
    const current = await load(org.id, id)
    if (current.status !== 'draft' && current.status !== 'rejected')
      throw new AppError('VALIDATION', 'Only drafts and rejected templates can be edited', {
        reason: 'not_editable',
      })
    const was = partsOf(current.components)
    const parts = {
      header: body.header === undefined ? was.header : body.header || undefined,
      body: body.body ?? was.body,
      footer: body.footer === undefined ? was.footer : body.footer || undefined,
      buttons: body.buttons ?? was.buttons,
    }
    const [row] = await db
      .update(templates)
      .set({
        components: componentsOf(parts),
        ...(body.category ? { category: body.category } : {}),
        ...(body.variables ? { variables: body.variables } : {}),
      })
      .where(and(eq(templates.id, id), eq(templates.orgId, org.id)))
      .returning()
    res.json(view(row!))
  })

  router.delete('/templates/:id', async (req, res) => {
    const org = orgOf(req)
    const { id } = uuidParam.parse(req.params)
    const t = await load(org.id, id)
    if (t.purpose !== 'custom')
      throw new AppError('VALIDATION', 'Reminders and receipts need this template', {
        reason: 'automation_template',
      })
    const busy = await db.$count(
      campaigns,
      and(
        eq(campaigns.orgId, org.id),
        eq(campaigns.templateId, t.id),
        inArray(campaigns.status, ['scheduled', 'sending']),
      ),
    )
    if (busy)
      throw new AppError('VALIDATION', 'A campaign is sending with this template', {
        reason: 'in_use',
      })
    if (t.metaTemplateId) {
      const account = await connectedAccount(db, org.id)
      if (account) {
        try {
          await deps.graph(account).deleteTemplate(account.wabaId, t.name, t.metaTemplateId)
        } catch (err) {
          // Already gone at Meta is fine; anything else, keep ours so they match.
          if (!(err instanceof GraphError) || err.retryable) throw err
          if (err.status !== 404 && err.code !== 100)
            throw new AppError('VALIDATION', err.details ?? err.message, { reason: 'meta_refused' })
        }
      }
    }
    await db.delete(templates).where(and(eq(templates.id, t.id), eq(templates.orgId, org.id)))
    await audit(db, req, {
      action: 'template.deleted',
      entity: 'template',
      entityId: t.id,
      diff: { name: t.name, language: t.language },
    })
    res.status(204).end()
  })

  router.post('/templates/:id/submit', async (req, res) => {
    const org = orgOf(req)
    const { id } = uuidParam.parse(req.params)
    const row = await submitTemplate(deps, org.id, id)
    await audit(db, req, { action: 'template.submitted', entity: 'template', entityId: id })
    deps.events.emit(org.id, 'template:updated', { templateId: id })
    res.json(view(row))
  })

  /** Onboarding's "Submit all" (spec §13): every draft, one by one; one refusal doesn't stop the rest. */
  router.post('/templates/submit-all', async (req, res) => {
    const org = orgOf(req)
    if (!(await connectedAccount(db, org.id)))
      throw new AppError('VALIDATION', 'Connect a WhatsApp number first', { reason: 'no_number' })
    const drafts = await db
      .select()
      .from(templates)
      .where(and(eq(templates.orgId, org.id), eq(templates.status, 'draft')))
    let submitted = 0
    const failed: { id: string; name: string; language: string; message: string }[] = []
    for (const t of drafts) {
      try {
        await submitTemplate(deps, org.id, t.id)
        submitted++
      } catch (err) {
        if (!(err instanceof AppError)) throw err
        failed.push({ id: t.id, name: t.name, language: t.language, message: err.message })
      }
    }
    await audit(db, req, {
      action: 'template.submitted_all',
      entity: 'template',
      diff: { submitted, failed: failed.length },
    })
    deps.events.emit(org.id, 'template:updated', {})
    res.json({ submitted, failed })
  })

  router.post('/templates/sync', async (req, res) => {
    const org = orgOf(req)
    if (!(await connectedAccount(db, org.id)))
      throw new AppError('VALIDATION', 'Connect a WhatsApp number first', { reason: 'no_number' })
    try {
      const result = await syncTemplates(deps, org.id)
      if (result.changed || result.added) deps.events.emit(org.id, 'template:updated', {})
      res.json(result)
    } catch (err) {
      if (err instanceof GraphError && !err.retryable)
        throw new AppError('VALIDATION', err.details ?? err.message, { reason: 'meta_refused' })
      if (err instanceof GraphError)
        throw new AppError('UNAVAILABLE', 'WhatsApp did not answer. Try again in a minute.')
      throw err
    }
  })

  return router
}

/**
 * Meta's name for a template the owner called "Diwali offer 2026":
 * diwali_offer_2026. A name in Hindi keeps no letters, so it gets a short tag.
 */
function metaName(name: string) {
  const slug = templateSlug(name)
  return slug === 'template' ? `template_${randomBytes(3).toString('hex')}` : slug
}
