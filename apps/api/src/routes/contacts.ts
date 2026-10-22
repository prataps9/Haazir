import { Router } from 'express'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { contacts } from '@haazir/db'
import { AppError } from '@haazir/shared'
import type { AppDeps } from '../deps'
import { audit, orgOf, uuidParam } from '../lib/http'

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
