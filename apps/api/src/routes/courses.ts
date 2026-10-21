import { Router } from 'express'
import multer from 'multer'
import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { batches, courses, knowledgeSources } from '@haazir/db'
import { AppError, planTotal } from '@haazir/shared'
import { requireRole } from '../auth/middleware'
import type { AppDeps } from '../deps'
import { audit, orgOf, uuidParam } from '../lib/http'

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
})

const plan = z
  .array(
    z.object({
      label: z.string().trim().min(1).max(40),
      amountPaise: z.number().int().positive(),
      dueOffsetDays: z.number().int().min(0).max(730),
    }),
  )
  .max(12)

const courseBody = z.object({
  name: z.string().trim().min(2).max(120),
  // WhatsApp list rows show 24 characters (spec §8).
  shortName: z.string().trim().min(1).max(24, 'Short name: at most 24 characters'),
  description: z.string().trim().max(1000).nullable().optional(),
  durationText: z.string().trim().max(40).nullable().optional(),
  mode: z.enum(['offline', 'online', 'hybrid']).default('offline'),
  feeTotalPaise: z.number().int().min(0),
  installmentPlan: plan.default([]),
  certificateText: z.string().trim().max(200).nullable().optional(),
  active: z.boolean().default(true),
  sort: z.number().int().min(0).max(1000).optional(),
})

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
const time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:00)?$/, 'Use HH:mm, e.g. 17:00')
  .transform((t) => (t.length === 5 ? `${t}:00` : t))
const batchBody = z.object({
  courseId: z.uuid(),
  name: z.string().trim().min(1).max(60),
  days: z.array(z.enum(DAYS)).min(1, 'Pick at least one day'),
  startTime: time,
  endTime: time,
  startDate: z.iso.date(),
  seatsTotal: z.number().int().min(1).max(1000),
  seatsFilled: z.number().int().min(0).max(1000).default(0),
  demoAllowed: z.boolean().default(true),
  branchLabel: z.string().trim().max(60).nullable().optional(),
  active: z.boolean().default(true),
})

/** The plan must add up to the fee: the bot quotes both (spec §16.6). */
function checkPlan(fee: number, steps: { amountPaise: number }[]) {
  if (steps.length && planTotal(steps as never) !== fee) {
    throw new AppError('VALIDATION', 'The installments must add up to the course fee')
  }
}

/** Courses & batches (spec §16.6): the only place the bot's fees and timings come from. */
export function coursesRouter(deps: Pick<AppDeps, 'db' | 'storage' | 'queues' | 'events'>) {
  const { db } = deps
  const router = Router()
  const admins = requireRole('owner', 'admin')

  const own = async (orgId: string, id: string) => {
    const [course] = await db
      .select()
      .from(courses)
      .where(and(eq(courses.id, id), eq(courses.orgId, orgId)))
    if (!course) throw new AppError('NOT_FOUND', 'Course not found')
    return course
  }

  router.get('/courses', async (req, res) => {
    const org = orgOf(req)
    const [courseRows, batchRows] = await Promise.all([
      db
        .select()
        .from(courses)
        .where(eq(courses.orgId, org.id))
        .orderBy(asc(courses.sort), asc(courses.name)),
      db
        .select()
        .from(batches)
        .where(eq(batches.orgId, org.id))
        .orderBy(asc(batches.startDate), asc(batches.startTime)),
    ])
    res.json({
      courses: courseRows.map((c) => ({
        ...c,
        hasBrochure: !!c.brochureKey,
        batches: batchRows.filter((b) => b.courseId === c.id),
      })),
    })
  })

  router.post('/courses', admins, async (req, res) => {
    const org = orgOf(req)
    const body = courseBody.parse(req.body)
    checkPlan(body.feeTotalPaise, body.installmentPlan)
    const [course] = await db
      .insert(courses)
      .values({ ...body, orgId: org.id })
      .returning()
    await audit(db, req, { action: 'course.created', entity: 'course', entityId: course!.id })
    res.status(201).json(course)
  })

  router.patch('/courses/:id', admins, async (req, res) => {
    const org = orgOf(req)
    const { id } = uuidParam.parse(req.params)
    const current = await own(org.id, id)
    const body = courseBody.partial().parse(req.body)
    checkPlan(
      body.feeTotalPaise ?? current.feeTotalPaise,
      body.installmentPlan ?? current.installmentPlan,
    )
    const [course] = await db.update(courses).set(body).where(eq(courses.id, id)).returning()
    await audit(db, req, {
      action: 'course.updated',
      entity: 'course',
      entityId: id,
      diff: Object.fromEntries(
        Object.keys(body).map((k) => [
          k,
          { from: current[k as keyof typeof current], to: body[k as keyof typeof body] },
        ]),
      ),
    })
    res.json(course)
  })

  /** The PDF the bot sends when asked, and learns from too. */
  router.post('/courses/:id/brochure', admins, upload.single('file'), async (req, res) => {
    const org = orgOf(req)
    const { id } = uuidParam.parse(req.params)
    const course = await own(org.id, id)
    if (!req.file || req.file.mimetype !== 'application/pdf')
      throw new AppError('VALIDATION', 'Upload the brochure as a PDF')
    const key = `orgs/${org.id}/courses/${course.id}/brochure.pdf`
    await deps.storage.put(key, req.file.buffer, 'application/pdf')
    await db.update(courses).set({ brochureKey: key }).where(eq(courses.id, id))

    const title = `${course.shortName} brochure`
    const [existing] = await db
      .select({ id: knowledgeSources.id })
      .from(knowledgeSources)
      .where(and(eq(knowledgeSources.orgId, org.id), eq(knowledgeSources.title, title)))
    const sourceId =
      existing?.id ??
      (
        await db
          .insert(knowledgeSources)
          .values({ orgId: org.id, type: 'pdf', title, fileKey: key })
          .returning({ id: knowledgeSources.id })
      )[0]!.id
    await db
      .update(knowledgeSources)
      .set({ status: 'pending', fileKey: key })
      .where(eq(knowledgeSources.id, sourceId))
    await deps.queues.ingest.add('ingest', { orgId: org.id, sourceId })
    deps.events.emit(org.id, 'knowledge:updated', { sourceId })
    await audit(db, req, { action: 'course.brochure', entity: 'course', entityId: id })
    res.status(201).json({ hasBrochure: true, knowledgeSourceId: sourceId })
  })

  const ownBatch = async (orgId: string, id: string) => {
    const [batch] = await db
      .select()
      .from(batches)
      .where(and(eq(batches.id, id), eq(batches.orgId, orgId)))
    if (!batch) throw new AppError('NOT_FOUND', 'Batch not found')
    return batch
  }

  router.post('/batches', admins, async (req, res) => {
    const org = orgOf(req)
    const body = batchBody.parse(req.body)
    await own(org.id, body.courseId)
    if (body.endTime <= body.startTime)
      throw new AppError('VALIDATION', 'The batch must end after it starts')
    const [batch] = await db
      .insert(batches)
      .values({ ...body, orgId: org.id })
      .returning()
    await audit(db, req, { action: 'batch.created', entity: 'batch', entityId: batch!.id })
    res.status(201).json(batch)
  })

  router.patch('/batches/:id', admins, async (req, res) => {
    const org = orgOf(req)
    const { id } = uuidParam.parse(req.params)
    const current = await ownBatch(org.id, id)
    const body = batchBody.partial().parse(req.body)
    if (body.courseId) await own(org.id, body.courseId)
    if ((body.endTime ?? current.endTime) <= (body.startTime ?? current.startTime))
      throw new AppError('VALIDATION', 'The batch must end after it starts')
    const [batch] = await db.update(batches).set(body).where(eq(batches.id, id)).returning()
    await audit(db, req, { action: 'batch.updated', entity: 'batch', entityId: id })
    res.json(batch)
  })

  return router
}
