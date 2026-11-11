import { Router } from 'express'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { contacts } from '@haazir/db'
import { contactsWhere } from '@haazir/messaging'
import { AppError, LEAD_STAGES, normalisePhone, type LeadStage } from '@haazir/shared'
import { requireRole } from '../auth/middleware'
import type { AppDeps } from '../deps'
import { csvCell } from '../lib/audience'
import { audit, orgOf, uuidParam } from '../lib/http'
import { istDate } from '../lib/time'

const PAGE = 50
const IMPORT_MAX = 2000
const TAGS_MAX = 20
const tag = z.string().trim().min(1).max(30)

/** The source recorded when consent arrives with an uploaded list (spec §19). */
export const IMPORT_OPT_IN_SOURCE = 'import'

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  tag: tag.optional(),
  stage: z.enum(LEAD_STAGES).optional(),
  consent: z.enum(['opted_in', 'opted_out', 'unknown']).optional(),
  page: z.coerce.number().int().min(0).max(10_000).default(0),
})

const contactView = {
  id: contacts.id,
  waId: contacts.waId,
  name: contacts.name,
  profileName: contacts.profileName,
  language: contacts.language,
  tags: contacts.tags,
  notes: contacts.notes,
  optInStatus: contacts.optInStatus,
  optInSource: contacts.optInSource,
  optInAt: contacts.optInAt,
  optedOutAt: contacts.optedOutAt,
  lastInboundAt: contacts.lastInboundAt,
  createdAt: contacts.createdAt,
}

/** The contact panel (spec §16.4). Lead stage and student info join in Phase 4. */
export function contactsRouter(deps: Pick<AppDeps, 'db' | 'now'>) {
  const router = Router()

  const load = async (orgId: string, id: string) => {
    const [row] = await deps.db
      .select(contactView)
      .from(contacts)
      .where(and(eq(contacts.id, id), eq(contacts.orgId, orgId)))
    if (!row) throw new AppError('NOT_FOUND', 'Contact not found')
    return row
  }

  const whereOf = (orgId: string, q: z.infer<typeof listQuery>) =>
    contactsWhere(orgId, {
      audience: { tags: q.tag ? [q.tag] : undefined, stages: q.stage ? [q.stage] : undefined },
      consent: q.consent,
      q: q.q,
    })
  const listView = {
    ...contactView,
    // Outer column qualified: a bare "id" here would bind to leads.
    stage: sql<LeadStage | null>`(select l.stage from leads l where l.contact_id = "contacts"."id" limit 1)`,
  }

  /** Everyone the institute has a number for, with who can and can't get campaigns. */
  router.get('/contacts', async (req, res) => {
    const org = orgOf(req)
    const q = listQuery.parse(req.query)
    const where = whereOf(org.id, q)
    const [rows, total] = await Promise.all([
      deps.db
        .select(listView)
        .from(contacts)
        .where(where)
        .orderBy(desc(contacts.createdAt), desc(contacts.id))
        .limit(PAGE)
        .offset(q.page * PAGE),
      deps.db.$count(contacts, where),
    ])
    res.json({ contacts: rows, total, page: q.page, pageSize: PAGE })
  })

  /** Every tag in use, most used first: the choices for filters and the campaign builder. */
  router.get('/contacts/tags', async (req, res) => {
    const org = orgOf(req)
    const rows = await deps.db
      .select({
        tag: sql<string>`t.tag`,
        count: sql<number>`count(*)::int`,
      })
      .from(sql`${contacts}, unnest(${contacts.tags}) as t(tag)`)
      .where(contactsWhere(org.id, {}))
      .groupBy(sql`t.tag`)
      .orderBy(sql`count(*) desc`, sql`t.tag`)
      .limit(200)
    res.json({ tags: rows })
  })

  router.get('/contacts/export', requireRole('owner', 'admin'), async (req, res) => {
    const org = orgOf(req)
    const q = listQuery.parse(req.query)
    const rows = await deps.db
      .select(listView)
      .from(contacts)
      .where(whereOf(org.id, q))
      .orderBy(desc(contacts.createdAt), desc(contacts.id))
      .limit(10_000)
    const header = ['Name', 'WhatsApp', 'Tags', 'Stage', 'Updates', 'Consent from', 'Consent on']
    const lines = rows.map((r) =>
      [
        r.name ?? r.profileName,
        `+${r.waId}`,
        r.tags.join('; '),
        r.stage,
        r.optInStatus,
        r.optInStatus === 'opted_in' ? r.optInSource : null,
        r.optInStatus === 'opted_in' ? r.optInAt : r.optedOutAt,
      ]
        .map(csvCell)
        .join(','),
    )
    await audit(deps.db, req, {
      action: 'contacts.exported',
      entity: 'contact',
      diff: { rows: rows.length },
    })
    res
      .type('text/csv')
      .attachment(`contacts-${istDate(deps.now())}.csv`)
      // BOM so Excel reads Hindi names as UTF-8.
      .send(`\uFEFF${[header.join(','), ...lines].join('\n')}\n`)
  })

  /** Add or remove tags on many contacts at once. Ids from another org match nothing. */
  router.post('/contacts/bulk-tag', async (req, res) => {
    const org = orgOf(req)
    const body = z
      .object({
        ids: z.array(z.uuid()).min(1).max(500),
        add: z.array(tag).max(TAGS_MAX).default([]),
        remove: z.array(tag).max(TAGS_MAX).default([]),
      })
      .refine((b) => b.add.length + b.remove.length > 0, 'Say which tags to add or remove')
      .parse(req.body)
    const rows = await deps.db
      .select({ id: contacts.id, tags: contacts.tags })
      .from(contacts)
      .where(and(eq(contacts.orgId, org.id), inArray(contacts.id, body.ids)))
    let updated = 0
    await deps.db.transaction(async (tx) => {
      for (const row of rows) {
        const next = [...new Set([...row.tags, ...body.add])]
          .filter((t) => !body.remove.includes(t))
          .slice(0, TAGS_MAX)
        if (next.length === row.tags.length && next.every((t, i) => t === row.tags[i])) continue
        await tx
          .update(contacts)
          .set({ tags: next })
          .where(and(eq(contacts.id, row.id), eq(contacts.orgId, org.id)))
        updated++
      }
    })
    await audit(deps.db, req, {
      action: 'contacts.tagged',
      entity: 'contact',
      diff: { contacts: updated, add: body.add, remove: body.remove },
    })
    res.json({ updated })
  })

  /**
   * A list the institute already has (an old register, a spreadsheet). New
   * numbers become contacts; known ones gain the tags and a missing name.
   *
   * Consent (spec §19): a row counts as "yes to updates" only when it says so
   * AND the person uploading declares they hold that consent. Otherwise the
   * contact stays "not asked", which keeps it out of every campaign. A STOP
   * sent on WhatsApp is never undone by a list.
   */
  router.post('/contacts/import', requireRole('owner', 'admin'), async (req, res) => {
    const org = orgOf(req)
    const body = z
      .object({
        rows: z
          .array(
            z.object({
              phone: z.string().max(40),
              name: z.string().trim().max(100).optional(),
              tags: z.array(tag).max(TAGS_MAX).optional(),
              consent: z.boolean().optional(),
            }),
          )
          .min(1)
          .max(IMPORT_MAX),
        /** Tags put on every row, e.g. the list's name. */
        tags: z.array(tag).max(TAGS_MAX).default([]),
        consentDeclared: z.boolean().default(false),
      })
      .parse(req.body)
    const now = deps.now()

    // One entry per number: a list often has the same parent twice.
    const wanted = new Map<string, { name?: string; tags: string[]; consent: boolean }>()
    const invalid: number[] = []
    body.rows.forEach((row, i) => {
      const waId = normalisePhone(row.phone)
      if (!waId) return void invalid.push(i + 1)
      const seen = wanted.get(waId)
      wanted.set(waId, {
        name: seen?.name ?? (row.name || undefined),
        tags: [...new Set([...(seen?.tags ?? []), ...body.tags, ...(row.tags ?? [])])],
        consent: (seen?.consent ?? false) || (body.consentDeclared && row.consent === true),
      })
    })
    const numbers = [...wanted.keys()]
    const tally = { created: 0, updated: 0, unchanged: 0, optedIn: 0 }

    await deps.db.transaction(async (tx) => {
      const existing = numbers.length
        ? await tx
            .select()
            .from(contacts)
            .where(and(eq(contacts.orgId, org.id), inArray(contacts.waId, numbers)))
        : []
      const known = new Map(existing.map((c) => [c.waId, c]))
      const fresh = numbers.filter((n) => !known.has(n))
      for (let i = 0; i < fresh.length; i += 500) {
        const inserted = await tx
          .insert(contacts)
          .values(
            fresh.slice(i, i + 500).map((waId) => {
              const w = wanted.get(waId)!
              if (w.consent) tally.optedIn++
              return {
                orgId: org.id,
                waId,
                name: w.name ?? null,
                tags: w.tags.slice(0, TAGS_MAX),
                ...(w.consent
                  ? {
                      optInStatus: 'opted_in' as const,
                      optInSource: IMPORT_OPT_IN_SOURCE,
                      optInAt: now,
                    }
                  : {}),
              }
            }),
          )
          .onConflictDoNothing()
          .returning({ id: contacts.id })
        tally.created += inserted.length
      }
      for (const [waId, current] of known) {
        const w = wanted.get(waId)!
        const tags = [...new Set([...current.tags, ...w.tags])].slice(0, TAGS_MAX)
        const set: Partial<typeof contacts.$inferInsert> = {}
        if (tags.length !== current.tags.length) set.tags = tags
        if (!current.name && w.name) set.name = w.name
        // Only "not asked" can become "yes" from a list; a STOP stands.
        if (w.consent && current.optInStatus === 'unknown') {
          Object.assign(set, {
            optInStatus: 'opted_in',
            optInSource: IMPORT_OPT_IN_SOURCE,
            optInAt: now,
          })
          tally.optedIn++
        }
        if (!Object.keys(set).length) {
          tally.unchanged++
          continue
        }
        await tx
          .update(contacts)
          .set(set)
          .where(and(eq(contacts.id, current.id), eq(contacts.orgId, org.id)))
        tally.updated++
      }
    })

    await audit(deps.db, req, {
      action: 'contacts.imported',
      entity: 'contact',
      diff: {
        rows: body.rows.length,
        ...tally,
        invalid: invalid.length,
        consentDeclared: body.consentDeclared,
      },
    })
    res.json({ ...tally, invalid: invalid.slice(0, 50), invalidCount: invalid.length })
  })

  router.get('/contacts/:id', async (req, res) => {
    const { id } = uuidParam.parse(req.params)
    res.json(await load(orgOf(req).id, id))
  })

  router.patch('/contacts/:id', async (req, res) => {
    const org = orgOf(req)
    const { id } = uuidParam.parse(req.params)
    const body = z
      .object({
        name: z.string().trim().max(100).nullable().optional(),
        tags: z.array(z.string().trim().min(1).max(30)).max(20).optional(),
        notes: z.string().max(2000).nullable().optional(),
        /**
         * Consent for updates and offers (spec §19: a record with source and
         * time). Staff record a yes they got in person or on a call, or a no.
         * A STOP sent on WhatsApp can only be undone by the person.
         */
        optIn: z.boolean().optional(),
      })
      .parse(req.body)
    const current = await load(org.id, id)
    const { optIn, ...fields } = body
    if (optIn && current.optInStatus === 'opted_out')
      throw new AppError('VALIDATION', 'They sent STOP; only they can start again', {
        reason: 'opted_out',
      })
    const consent =
      optIn === undefined || (optIn && current.optInStatus === 'opted_in')
        ? {}
        : optIn
          ? { optInStatus: 'opted_in' as const, optInSource: 'staff', optInAt: deps.now() }
          : { optInStatus: 'opted_out' as const, optedOutAt: deps.now() }
    await deps.db
      .update(contacts)
      .set({ ...fields, ...consent })
      .where(and(eq(contacts.id, id), eq(contacts.orgId, org.id)))
    if (optIn !== undefined)
      await audit(deps.db, req, {
        action: optIn ? 'contact.opted_in' : 'contact.opted_out',
        entity: 'contact',
        entityId: id,
      })
    res.json(await load(org.id, id))
  })

  return router
}
