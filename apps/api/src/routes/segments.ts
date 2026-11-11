import { Router } from 'express'
import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { segments } from '@haazir/db'
import { audienceCount } from '@haazir/messaging'
import { AppError } from '@haazir/shared'
import { requireRole } from '../auth/middleware'
import type { AppDeps } from '../deps'
import { audienceSchema } from '../lib/audience'
import { audit, orgOf, userOf, uuidParam } from '../lib/http'

const body = z.object({
  name: z.string().trim().min(1).max(60),
  filters: audienceSchema,
})

/**
 * Saved audiences (owners and admins, like campaigns). A segment is a set of
 * filters; the count beside it is worked out now, by the same code that
 * decides who a campaign reaches.
 */
export function segmentsRouter(deps: Pick<AppDeps, 'db'>) {
  const { db } = deps
  const router = Router()
  router.use('/segments', requireRole('owner', 'admin'))

  const own = async (orgId: string, id: string) => {
    const [row] = await db
      .select()
      .from(segments)
      .where(and(eq(segments.id, id), eq(segments.orgId, orgId)))
    if (!row) throw new AppError('NOT_FOUND', 'Segment not found')
    return row
  }
  const view = async (s: typeof segments.$inferSelect) => ({
    id: s.id,
    name: s.name,
    filters: s.filters,
    createdAt: s.createdAt,
    ...(await audienceCount(db, s.orgId, s.filters)),
  })
  const taken = (err: unknown) =>
    /segments_org_name_unique/.test(
      `${(err as Error).message} ${((err as { cause?: Error }).cause ?? { message: '' }).message}`,
    )
      ? new AppError('VALIDATION', 'A segment with this name already exists', {
          reason: 'name_taken',
        })
      : err

  router.get('/segments', async (req, res) => {
    const org = orgOf(req)
    const rows = await db
      .select()
      .from(segments)
      .where(eq(segments.orgId, org.id))
      .orderBy(asc(segments.name))
    res.json({ segments: await Promise.all(rows.map(view)) })
  })

  router.post('/segments', async (req, res) => {
    const org = orgOf(req)
    const input = body.parse(req.body)
    try {
      const [row] = await db
        .insert(segments)
        .values({ orgId: org.id, ...input, createdByUserId: userOf(req).id })
        .returning()
      await audit(db, req, { action: 'segment.created', entity: 'segment', entityId: row!.id })
      res.status(201).json(await view(row!))
    } catch (err) {
      throw taken(err)
    }
  })

  router.patch('/segments/:id', async (req, res) => {
    const org = orgOf(req)
    const { id } = uuidParam.parse(req.params)
    const input = body.partial().parse(req.body)
    await own(org.id, id)
    try {
      await db
        .update(segments)
        .set(input)
        .where(and(eq(segments.id, id), eq(segments.orgId, org.id)))
    } catch (err) {
      throw taken(err)
    }
    res.json(await view(await own(org.id, id)))
  })

  router.delete('/segments/:id', async (req, res) => {
    const org = orgOf(req)
    const { id } = uuidParam.parse(req.params)
    await own(org.id, id)
    await db.delete(segments).where(and(eq(segments.id, id), eq(segments.orgId, org.id)))
    await audit(db, req, { action: 'segment.deleted', entity: 'segment', entityId: id })
    res.json({ ok: true })
  })

  return router
}
