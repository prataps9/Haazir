import { Router } from 'express'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { contacts } from '@haazir/db'
import { AppError } from '@haazir/shared'
import type { AppDeps } from '../deps'
import { orgOf, uuidParam } from '../lib/http'

const contactView = {
  id: contacts.id,
  waId: contacts.waId,
  name: contacts.name,
  profileName: contacts.profileName,
  language: contacts.language,
  tags: contacts.tags,
  notes: contacts.notes,
  optInStatus: contacts.optInStatus,
  optedOutAt: contacts.optedOutAt,
  lastInboundAt: contacts.lastInboundAt,
  createdAt: contacts.createdAt,
}

/** The contact panel (spec §16.4). Lead stage and student info join in Phase 4. */
export function contactsRouter(deps: Pick<AppDeps, 'db'>) {
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
      })
      .parse(req.body)
    await load(org.id, id)
    await deps.db
      .update(contacts)
      .set(body)
      .where(and(eq(contacts.id, id), eq(contacts.orgId, org.id)))
    res.json(await load(org.id, id))
  })

  return router
}
