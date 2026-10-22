import { and, asc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm'
import type { campaigns, templates } from '@haazir/db'
import {
  batches,
  campaignRecipients,
  contacts,
  courses,
  leads,
  messages,
  students,
  type AnyDatabase,
} from '@haazir/db'
import {
  costPaise,
  fillTemplate,
  gstPaise,
  partsOf,
  pricingCategoryOf,
  templateParam,
  type CampaignAudience,
  type CampaignVariable,
  type TemplateCategory,
} from '@haazir/shared'
import type { OutboundContent } from '@haazir/whatsapp'
import { ratesOn } from './rates'

export type Campaign = typeof campaigns.$inferSelect
type Template = typeof templates.$inferSelect

/** Contacts that belong to the team (the owner's own number for the daily summary), never a campaign audience. */
export const TEAM_OPT_IN_SOURCE = 'team'

/**
 * Who matches an audience's filters, before the opt-in rule. Playground and
 * team contacts never count. Course and batch match an enquiry or an admission.
 */
function audienceFilters(orgId: string, audience: CampaignAudience): SQL[] {
  const where: SQL[] = [
    eq(contacts.orgId, orgId),
    sql`${contacts.waId} not like 'playground-%'`,
    sql`coalesce(${contacts.optInSource}, '') <> ${TEAM_OPT_IN_SOURCE}`,
  ]
  if (audience.tags?.length)
    where.push(
      sql`${contacts.tags} && ${sql`array[${sql.join(
        audience.tags.map((t) => sql`${t}`),
        sql`, `,
      )}]::text[]`}`,
    )
  if (audience.stages?.length)
    where.push(
      sql`exists (select 1 from ${leads} where ${leads.contactId} = ${contacts.id} and ${leads.orgId} = ${orgId} and ${inArray(leads.stage, audience.stages)})`,
    )
  if (audience.courseIds?.length)
    where.push(
      sql`(exists (select 1 from ${leads} where ${leads.contactId} = ${contacts.id} and ${leads.orgId} = ${orgId} and ${inArray(leads.courseId, audience.courseIds)})
        or exists (select 1 from ${students} where ${students.contactId} = ${contacts.id} and ${students.orgId} = ${orgId} and ${inArray(students.courseId, audience.courseIds)}))`,
    )
  if (audience.batchIds?.length)
    where.push(
      sql`(exists (select 1 from ${leads} where ${leads.contactId} = ${contacts.id} and ${leads.orgId} = ${orgId} and ${inArray(leads.batchId, audience.batchIds)})
        or exists (select 1 from ${students} where ${students.contactId} = ${contacts.id} and ${students.orgId} = ${orgId} and ${inArray(students.batchId, audience.batchIds)}))`,
    )
  return where
}

/** The audience: opted-in contacts only, enforced here and nowhere else (spec §16.8). */
export function audienceWhere(orgId: string, audience: CampaignAudience): SQL {
  return and(...audienceFilters(orgId, audience), eq(contacts.optInStatus, 'opted_in'))!
}

/**
 * The live count for the builder: how many will get it, and how many match
 * but are left out because they haven't opted in (or opted out).
 */
export async function audienceCount(db: AnyDatabase, orgId: string, audience: CampaignAudience) {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      optedIn: sql<number>`(count(*) filter (where ${contacts.optInStatus} = 'opted_in'))::int`,
      optedOut: sql<number>`(count(*) filter (where ${contacts.optInStatus} = 'opted_out'))::int`,
    })
    .from(contacts)
    .where(and(...audienceFilters(orgId, audience)))
  return {
    count: row?.optedIn ?? 0,
    optedOut: row?.optedOut ?? 0,
    noConsent: (row?.total ?? 0) - (row?.optedIn ?? 0) - (row?.optedOut ?? 0),
  }
}

/** What a person's {{n}} values come from: their name and their latest course and batch. */
export interface RecipientContext {
  name: string | null
  course: string | null
  batch: string | null
}

/** A contact's name, course and batch (an admission wins over an enquiry). */
export const recipientContext = {
  name: sql<string | null>`coalesce(${contacts.name}, ${contacts.profileName})`,
  course: sql<string | null>`coalesce(
    (select ${courses.shortName} from ${students} join ${courses} on ${courses.id} = ${students.courseId}
      where ${students.contactId} = ${contacts.id} order by ${students.createdAt} desc limit 1),
    (select ${courses.shortName} from ${leads} join ${courses} on ${courses.id} = ${leads.courseId}
      where ${leads.contactId} = ${contacts.id} limit 1))`,
  batch: sql<string | null>`coalesce(
    (select ${batches.name} from ${students} join ${batches} on ${batches.id} = ${students.batchId}
      where ${students.contactId} = ${contacts.id} order by ${students.createdAt} desc limit 1),
    (select ${batches.name} from ${leads} join ${batches} on ${batches.id} = ${leads.batchId}
      where ${leads.contactId} = ${contacts.id} limit 1))`,
}

/** {{1}}, {{2}}… for one person, flattened as Meta requires. */
export function campaignValues(map: CampaignVariable[], who: RecipientContext): string[] {
  return map.map((v) => {
    const fixed = v.text?.trim() ?? ''
    const value =
      v.source === 'contact_name'
        ? who.name
        : v.source === 'course'
          ? who.course
          : v.source === 'batch'
            ? who.batch
            : fixed
    return templateParam(value?.trim() || fixed)
  })
}

/** The text a person reads (the builder's preview). */
export function campaignPreview(template: Template, values: string[]): string {
  return fillTemplate(partsOf(template.components).body, values)
}

/** The template message for one person. */
export function campaignContent(template: Template, values: string[]): OutboundContent {
  return {
    kind: 'template',
    name: template.name,
    language: template.language,
    components: values.length
      ? [{ type: 'body', parameters: values.map((text) => ({ type: 'text', text })) }]
      : [],
  }
}

const istDay = (d: Date) => new Date(d.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10)

/**
 * Spec §10 "Cost estimate": audience × Meta's rate for the template's
 * category, GST shown separately. An upper bound: Meta only charges for
 * messages delivered.
 */
export async function estimateCost(
  db: AnyDatabase,
  input: { recipients: number; category: TemplateCategory; on: Date },
) {
  const rates = await ratesOn(db, istDay(input.on))
  const rate = rates[input.category]
  const paise = costPaise(input.recipients, rate)
  return {
    recipients: input.recipients,
    category: input.category,
    rateCentipaise: rate,
    costPaise: paise,
    gstPaise: gstPaise(paise),
  }
}

/**
 * The results page (spec §16.8): sent, delivered, read, replied, failed
 * (with reasons) and what it actually cost, from the messages themselves, so
 * the numbers keep up as Meta's statuses arrive.
 */
export async function campaignResults(db: AnyDatabase, campaign: Campaign, template?: Template) {
  const rows = await db
    .select({
      recipientStatus: campaignRecipients.status,
      recipientError: campaignRecipients.errorCode,
      status: messages.status,
      errorCode: messages.errorCode,
      errorTitle: messages.errorTitle,
      billable: messages.billable,
      pricingCategory: messages.pricingCategory,
      replied: sql<boolean>`exists (select 1 from ${messages} i where i.conversation_id = ${messages.conversationId}
        and i.direction = 'in' and i.created_at > ${messages.createdAt})`,
    })
    .from(campaignRecipients)
    .leftJoin(messages, eq(messages.id, campaignRecipients.messageId))
    .where(
      and(
        eq(campaignRecipients.campaignId, campaign.id),
        eq(campaignRecipients.orgId, campaign.orgId),
      ),
    )

  const counts = {
    recipients: rows.length,
    pending: 0,
    sent: 0,
    delivered: 0,
    read: 0,
    replied: 0,
    failed: 0,
    skipped: 0,
  }
  const failures = new Map<string, { code: string; title: string | null; count: number }>()
  const billed = new Map<string, number>()
  for (const r of rows) {
    if (r.recipientStatus === 'skipped') counts.skipped++
    else if (r.recipientStatus === 'pending') counts.pending++
    if (r.recipientStatus === 'failed' || r.status === 'failed') {
      counts.failed++
      const code = r.errorCode ?? r.recipientError ?? 'unknown'
      const f = failures.get(code) ?? { code, title: r.errorTitle, count: 0 }
      f.count++
      failures.set(code, f)
    }
    if (r.status === 'sent' || r.status === 'delivered' || r.status === 'read') counts.sent++
    if (r.status === 'delivered' || r.status === 'read') {
      counts.delivered++
      // Meta charges per delivered template message, unless it says otherwise.
      if (r.billable !== false) {
        const category = pricingCategoryOf(r.pricingCategory) ?? template?.category ?? 'marketing'
        billed.set(category, (billed.get(category) ?? 0) + 1)
      }
    }
    if (r.status === 'read') counts.read++
    if (r.replied && r.status !== 'failed') counts.replied++
  }

  const rates = await ratesOn(db, istDay(campaign.startedAt ?? campaign.createdAt))
  let actual = 0
  for (const [category, n] of billed) actual += (n * rates[category as keyof typeof rates]) / 100
  const actualCostPaise = Math.round(actual)
  return {
    ...counts,
    failures: [...failures.values()].sort((a, b) => b.count - a.count),
    actualCostPaise,
    actualGstPaise: gstPaise(actualCostPaise),
  }
}

/** The next people to send to, in a stable order, with what their variables need. */
export async function pendingRecipients(db: AnyDatabase, campaignId: string, limit: number) {
  return db
    .select({
      id: campaignRecipients.id,
      contactId: campaignRecipients.contactId,
      optInStatus: contacts.optInStatus,
      ...recipientContext,
    })
    .from(campaignRecipients)
    .innerJoin(contacts, eq(contacts.id, campaignRecipients.contactId))
    .where(
      and(eq(campaignRecipients.campaignId, campaignId), eq(campaignRecipients.status, 'pending')),
    )
    .orderBy(asc(campaignRecipients.createdAt), asc(campaignRecipients.id))
    .limit(limit)
}

/**
 * Writes the audience as it is now into campaign_recipients. Safe to repeat:
 * one row per person, and nobody is added once sending has begun.
 */
export async function snapshotAudience(db: AnyDatabase, campaign: Campaign) {
  const already = await db.$count(
    campaignRecipients,
    eq(campaignRecipients.campaignId, campaign.id),
  )
  if (already) return already
  const rows = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(audienceWhere(campaign.orgId, campaign.audience))
    .orderBy(asc(contacts.createdAt), asc(contacts.id))
  if (!rows.length) return 0
  await db
    .insert(campaignRecipients)
    .values(rows.map((r) => ({ orgId: campaign.orgId, campaignId: campaign.id, contactId: r.id })))
    .onConflictDoNothing()
  return rows.length
}

/** Recipients whose message row exists but never reached the outbound queue (a crash in between). */
export async function unsentQueued(db: AnyDatabase, campaignId: string) {
  return db
    .select({ messageId: messages.id })
    .from(campaignRecipients)
    .innerJoin(messages, eq(messages.id, campaignRecipients.messageId))
    .where(
      and(
        eq(campaignRecipients.campaignId, campaignId),
        eq(campaignRecipients.status, 'queued'),
        eq(messages.status, 'queued'),
        sql`${messages.waMessageId} is null`,
        ne(messages.direction, 'in'),
      ),
    )
}

/** The list's numbers for many campaigns in one query (the detail page uses campaignResults). */
export async function campaignStats(db: AnyDatabase, orgId: string, campaignIds: string[]) {
  if (!campaignIds.length) return new Map<string, CampaignStats>()
  const rows = await db
    .select({
      campaignId: campaignRecipients.campaignId,
      recipients: sql<number>`count(*)::int`,
      sent: sql<number>`(count(*) filter (where ${messages.status} in ('sent', 'delivered', 'read')))::int`,
      delivered: sql<number>`(count(*) filter (where ${messages.status} in ('delivered', 'read')))::int`,
      read: sql<number>`(count(*) filter (where ${messages.status} = 'read'))::int`,
      failed: sql<number>`(count(*) filter (where ${messages.status} = 'failed' or ${campaignRecipients.status} = 'failed'))::int`,
    })
    .from(campaignRecipients)
    .leftJoin(messages, eq(messages.id, campaignRecipients.messageId))
    .where(
      and(eq(campaignRecipients.orgId, orgId), inArray(campaignRecipients.campaignId, campaignIds)),
    )
    .groupBy(campaignRecipients.campaignId)
  return new Map(rows.map(({ campaignId, ...stats }) => [campaignId, stats]))
}
export interface CampaignStats {
  recipients: number
  sent: number
  delivered: number
  read: number
  failed: number
}
