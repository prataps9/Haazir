import { Router } from 'express'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { sequenceEnrollments, sequenceSteps, sequences, templates } from '@haazir/db'
import { ratesOn, sequenceCanFill, sequenceMaxCostPaise } from '@haazir/messaging'
import {
  AppError,
  partsOf,
  SEQUENCE_MAX_DELAY_HOURS,
  SEQUENCE_MAX_STEPS,
  SEQUENCE_TRIGGERS,
  type SequenceTrigger,
} from '@haazir/shared'
import { requireRole } from '../auth/middleware'
import type { AppDeps } from '../deps'
import { audit, orgOf } from '../lib/http'
import { istDate } from '../lib/time'

const triggerParam = z.object({ trigger: z.enum(SEQUENCE_TRIGGERS) })
const body = z.object({
  enabled: z.boolean(),
  steps: z
    .array(
      z.object({
        delayHours: z.number().int().min(1).max(SEQUENCE_MAX_DELAY_HOURS),
        templateId: z.uuid(),
      }),
    )
    .max(SEQUENCE_MAX_STEPS),
})

/**
 * Follow-up sequences (owners and admins): one per trigger, up to three
 * template messages each, off until switched on. The figure shown beside each
 * is the most it can cost per lead at Meta's rates today.
 */
export function sequencesRouter(deps: Pick<AppDeps, 'db' | 'now'>) {
  const { db } = deps
  const router = Router()
  router.use('/sequences', requireRole('owner', 'admin'))

  const load = async (orgId: string) => {
    const [rows, steps, counts, usable] = await Promise.all([
      db.select().from(sequences).where(eq(sequences.orgId, orgId)),
      db
        .select({
          sequenceId: sequenceSteps.sequenceId,
          position: sequenceSteps.position,
          delayHours: sequenceSteps.delayHours,
          templateId: sequenceSteps.templateId,
        })
        .from(sequenceSteps)
        .where(eq(sequenceSteps.orgId, orgId))
        .orderBy(asc(sequenceSteps.position)),
      db
        .select({
          sequenceId: sequenceEnrollments.sequenceId,
          status: sequenceEnrollments.status,
          n: sql<number>`count(*)::int`,
        })
        .from(sequenceEnrollments)
        .where(eq(sequenceEnrollments.orgId, orgId))
        .groupBy(sequenceEnrollments.sequenceId, sequenceEnrollments.status),
      db
        .select()
        .from(templates)
        .where(and(eq(templates.orgId, orgId), eq(templates.status, 'approved')))
        .orderBy(asc(templates.name)),
    ])
    const choices = usable.filter(sequenceCanFill)
    const byId = new Map(choices.map((t) => [t.id, t]))
    const today = istDate(deps.now())

    const list = await Promise.all(
      SEQUENCE_TRIGGERS.map(async (trigger) => {
        const row = rows.find((r) => r.trigger === trigger)
        const mine = steps.filter((s) => s.sequenceId === row?.id)
        const count = (status: string) =>
          counts.find((c) => c.sequenceId === row?.id && c.status === status)?.n ?? 0
        return {
          trigger,
          enabled: row?.enabled ?? false,
          steps: mine.map((s) => ({
            delayHours: s.delayHours,
            templateId: s.templateId,
            // A template that was deleted or lost its approval can't be sent.
            usable: !!s.templateId && byId.has(s.templateId),
          })),
          maxCostPaisePerLead: await sequenceMaxCostPaise(
            db,
            mine.flatMap((s) => {
              const t = s.templateId ? byId.get(s.templateId) : undefined
              return t ? [t.category] : []
            }),
            today,
          ),
          counts: { active: count('active'), done: count('done'), stopped: count('stopped') },
        }
      }),
    )
    return {
      sequences: list,
      templates: choices.map((t) => ({
        id: t.id,
        name: t.name,
        language: t.language,
        category: t.category,
        purpose: t.purpose,
        body: partsOf(t.components).body,
      })),
      maxSteps: SEQUENCE_MAX_STEPS,
      // Meta's rate per message today, in centipaise, so the form can show the cost before saving.
      rates: await ratesOn(db, today),
    }
  }

  router.get('/sequences', async (req, res) => {
    res.json(await load(orgOf(req).id))
  })

  router.put('/sequences/:trigger', async (req, res) => {
    const org = orgOf(req)
    const { trigger } = triggerParam.parse(req.params)
    const input = body.parse(req.body)

    // Later steps come later, and every template is this org's, approved and fillable.
    for (let i = 1; i < input.steps.length; i++)
      if (input.steps[i]!.delayHours <= input.steps[i - 1]!.delayHours)
        throw new AppError('VALIDATION', 'Each step must come after the one before it', {
          reason: 'step_order',
        })
    const ids = [...new Set(input.steps.map((s) => s.templateId))]
    const found = ids.length
      ? await db
          .select()
          .from(templates)
          .where(and(eq(templates.orgId, org.id), inArray(templates.id, ids)))
      : []
    if (found.length !== ids.length) throw new AppError('NOT_FOUND', 'Template not found')
    const bad = found.find((t) => t.status !== 'approved' || !sequenceCanFill(t))
    if (bad)
      throw new AppError('VALIDATION', `"${bad.name}" can't be used in a sequence`, {
        reason: bad.status !== 'approved' ? 'not_approved' : 'unfillable',
      })
    if (input.enabled && !input.steps.length)
      throw new AppError('VALIDATION', 'Add at least one message before switching it on', {
        reason: 'no_steps',
      })

    const now = deps.now()
    await db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(sequences)
        .where(and(eq(sequences.orgId, org.id), eq(sequences.trigger, trigger)))
      // Switching on starts the clock: only leads that reach the trigger from now are enrolled.
      const enabledAt = input.enabled ? (before?.enabled ? before.enabledAt : now) : null
      const [row] = await tx
        .insert(sequences)
        .values({ orgId: org.id, trigger, enabled: input.enabled, enabledAt })
        .onConflictDoUpdate({
          target: [sequences.orgId, sequences.trigger],
          set: { enabled: input.enabled, enabledAt },
        })
        .returning()
      await tx
        .delete(sequenceSteps)
        .where(and(eq(sequenceSteps.sequenceId, row!.id), eq(sequenceSteps.orgId, org.id)))
      if (input.steps.length)
        await tx.insert(sequenceSteps).values(
          input.steps.map((s, i) => ({
            orgId: org.id,
            sequenceId: row!.id,
            position: i + 1,
            delayHours: s.delayHours,
            templateId: s.templateId,
          })),
        )
    })
    await audit(db, req, {
      action: input.enabled ? 'sequence.enabled' : 'sequence.saved',
      entity: 'sequence',
      diff: { trigger, steps: input.steps.length },
    })
    const all = await load(org.id)
    res.json(all.sequences.find((s) => s.trigger === (trigger as SequenceTrigger)))
  })

  return router
}
