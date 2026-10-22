import { and, eq, inArray, or } from 'drizzle-orm'
import { templates, whatsappAccounts, type AnyDatabase } from '@haazir/db'
import {
  AppError,
  componentsForMeta,
  partsOf,
  templateProblems,
  type TemplateCategory,
  type TemplateStatus,
} from '@haazir/shared'
import {
  GraphError,
  type GraphClient,
  type MetaTemplate,
  type TemplateUpdate,
} from '@haazir/whatsapp'
import type { WhatsappAccount } from './accounts'

export type Template = typeof templates.$inferSelect

/** Meta's review states, in ours. Disabled and archived templates can't be sent: paused. */
export function statusFromMeta(status: string): TemplateStatus {
  switch (status.toUpperCase()) {
    case 'APPROVED':
      return 'approved'
    case 'REJECTED':
    case 'LIMIT_EXCEEDED':
      return 'rejected'
    case 'PAUSED':
    case 'DISABLED':
    case 'ARCHIVED':
      return 'paused'
    default:
      return 'pending' // PENDING, IN_APPEAL, PENDING_DELETION…
  }
}

function categoryFromMeta(category: string | undefined): TemplateCategory | undefined {
  const c = category?.toLowerCase()
  return c === 'utility' || c === 'marketing' || c === 'authentication' ? c : undefined
}

/** The org's connected number (templates live on its WhatsApp Business Account). */
export async function connectedAccount(db: AnyDatabase, orgId: string) {
  const [account] = await db
    .select()
    .from(whatsappAccounts)
    .where(and(eq(whatsappAccounts.orgId, orgId), eq(whatsappAccounts.status, 'connected')))
    .limit(1)
  return account ?? null
}

interface GraphDeps {
  db: AnyDatabase
  graph(account: WhatsappAccount): GraphClient
}

/**
 * Sends a draft (or a rejected template, edited) to Meta for review (spec
 * §16.9 "Meta ko bhejein"). Checks Meta's rules first, so a mistake is
 * reported now rather than as a rejection tomorrow.
 *
 * Throws VALIDATION with `details.problems` (rule keys), `details.reason =
 * 'no_number'`, or Meta's own message when it refuses.
 */
export async function submitTemplate(deps: GraphDeps, orgId: string, templateId: string) {
  const [template] = await deps.db
    .select()
    .from(templates)
    .where(and(eq(templates.id, templateId), eq(templates.orgId, orgId)))
  if (!template) throw new AppError('NOT_FOUND', 'Template not found')
  if (template.status !== 'draft' && template.status !== 'rejected')
    throw new AppError('VALIDATION', 'This template is already with Meta', {
      reason: 'already_submitted',
    })

  const problems = templateProblems(partsOf(template.components))
  if (problems.length)
    throw new AppError('VALIDATION', 'The template breaks one of WhatsApp’s rules', { problems })

  const account = await connectedAccount(deps.db, orgId)
  if (!account)
    throw new AppError('VALIDATION', 'Connect a WhatsApp number first', { reason: 'no_number' })

  const graph = deps.graph(account)
  const components = componentsForMeta(template.components, template.variables)
  let status: TemplateStatus = 'pending'
  let metaTemplateId = template.metaTemplateId
  let category = template.category
  try {
    if (template.status === 'rejected' && template.metaTemplateId) {
      await graph.editTemplate(template.metaTemplateId, { category, components })
    } else {
      const created = await graph.createTemplate(account.wabaId, {
        name: template.name,
        language: template.language,
        category,
        components,
      })
      metaTemplateId = created.id
      status = statusFromMeta(created.status)
      category = categoryFromMeta(created.category) ?? category
    }
  } catch (err) {
    if (err instanceof GraphError && !err.retryable)
      throw new AppError('VALIDATION', err.details ?? err.message, { reason: 'meta_refused' })
    throw err
  }

  const [updated] = await deps.db
    .update(templates)
    .set({ status, metaTemplateId, category, rejectionReason: null })
    .where(eq(templates.id, template.id))
    .returning()
  return updated!
}

/**
 * Brings every template of the org in line with Meta (spec §10: webhook plus
 * a 15-minute poll). Templates made in Meta's own tools are added, so they
 * can be used for campaigns too. Returns how many rows changed.
 */
export async function syncTemplates(deps: GraphDeps, orgId: string) {
  const account = await connectedAccount(deps.db, orgId)
  if (!account) return { changed: 0, added: 0 }
  const remote = await deps.graph(account).listTemplates(account.wabaId)
  const local = await deps.db.select().from(templates).where(eq(templates.orgId, orgId))

  let changed = 0
  let added = 0
  for (const t of remote) {
    const match =
      local.find((l) => l.metaTemplateId === t.id) ??
      local.find((l) => l.name === t.name && l.language === t.language)
    if (!match) {
      if (await importTemplate(deps.db, orgId, t)) added++
      continue
    }
    const next = {
      metaTemplateId: t.id,
      status: statusFromMeta(t.status),
      category: categoryFromMeta(t.category) ?? match.category,
      rejectionReason: statusFromMeta(t.status) === 'rejected' ? (t.rejectedReason ?? null) : null,
    }
    if (
      match.metaTemplateId !== next.metaTemplateId ||
      match.status !== next.status ||
      match.category !== next.category ||
      match.rejectionReason !== next.rejectionReason
    ) {
      // A draft that happens to share a name with a template at Meta is that template now.
      await deps.db.update(templates).set(next).where(eq(templates.id, match.id))
      changed++
    }
  }
  return { changed, added }
}

async function importTemplate(db: AnyDatabase, orgId: string, t: MetaTemplate) {
  const category = categoryFromMeta(t.category)
  if (!category || !t.components?.length) return false
  const components = t.components.map((c) => {
    const { example: _example, ...rest } = c as Record<string, unknown> & { example?: unknown }
    return { ...rest, type: String(rest.type ?? '').toUpperCase() }
  })
  const rows = await db
    .insert(templates)
    .values({
      orgId,
      name: t.name,
      language: t.language,
      category,
      components,
      variables: [],
      metaTemplateId: t.id,
      status: statusFromMeta(t.status),
      rejectionReason: t.rejectedReason ?? null,
      purpose: 'custom',
    })
    .onConflictDoNothing()
    .returning({ id: templates.id })
  return rows.length > 0
}

/**
 * A review result or category change from Meta's webhook. Matched to orgs by
 * the WhatsApp Business Account it came from, then by Meta's template id
 * (or name + language, for a submission whose answer beat our own write).
 * Returns the orgs whose templates changed, for live updates.
 */
export async function applyTemplateUpdate(db: AnyDatabase, update: TemplateUpdate) {
  const accounts = await db
    .select({ orgId: whatsappAccounts.orgId })
    .from(whatsappAccounts)
    .where(eq(whatsappAccounts.wabaId, update.wabaId))
  const orgIds = [...new Set(accounts.map((a) => a.orgId))]
  if (!orgIds.length) return []

  const status = update.event ? statusFromMeta(update.event) : undefined
  const category = categoryFromMeta(update.newCategory)
  if (!status && !category) return []
  const rows = await db
    .update(templates)
    .set({
      metaTemplateId: update.metaTemplateId,
      ...(status
        ? {
            status,
            rejectionReason:
              status === 'rejected' || status === 'paused'
                ? (update.reason ?? update.event ?? null)
                : null,
          }
        : {}),
      ...(category ? { category } : {}),
    })
    .where(
      and(
        inArray(templates.orgId, orgIds),
        or(
          eq(templates.metaTemplateId, update.metaTemplateId),
          update.name && update.language
            ? and(eq(templates.name, update.name), eq(templates.language, update.language))
            : undefined,
        ),
      ),
    )
    .returning({ orgId: templates.orgId })
  return [...new Set(rows.map((r) => r.orgId))]
}
