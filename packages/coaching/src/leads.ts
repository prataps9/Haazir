import { and, eq } from 'drizzle-orm'
import { leadEvents, leads, students, type AnyDatabase } from '@haazir/db'
import { LEAD_STAGES, type LeadSource, type LeadStage } from '@haazir/shared'

export type Lead = typeof leads.$inferSelect
export type Actor = { actor: 'bot' | 'system' } | { actor: 'user'; actorUserId: string }

const rank = (s: LeadStage) => LEAD_STAGES.indexOf(s)

/**
 * The contact's lead, created on first contact (spec §16.5). Students who
 * write in don't become leads; their chats are about fees and classes.
 * Fills in course and student name when the lead doesn't have them yet.
 */
export async function ensureLead(
  db: AnyDatabase,
  input: {
    orgId: string
    contactId: string
    source?: LeadSource
    courseId?: string | null
    studentName?: string | null
    notes?: string | null
  } & Actor,
): Promise<(Lead & { isNew?: true }) | null> {
  const [existing] = await db
    .select()
    .from(leads)
    .where(and(eq(leads.orgId, input.orgId), eq(leads.contactId, input.contactId)))
  if (existing) {
    const patch: Partial<Lead> = {}
    if (input.courseId && !existing.courseId) patch.courseId = input.courseId
    if (input.studentName && !existing.studentName) patch.studentName = input.studentName
    if (input.notes)
      patch.notes = existing.notes ? `${existing.notes}\n${input.notes}` : input.notes
    if (!Object.keys(patch).length) return existing
    const [updated] = await db.update(leads).set(patch).where(eq(leads.id, existing.id)).returning()
    return updated ?? existing
  }

  const [student] = await db
    .select({ id: students.id })
    .from(students)
    .where(and(eq(students.orgId, input.orgId), eq(students.contactId, input.contactId)))
    .limit(1)
  if (student) return null

  const [created] = await db
    .insert(leads)
    .values({
      orgId: input.orgId,
      contactId: input.contactId,
      source: input.source ?? 'whatsapp',
      courseId: input.courseId ?? null,
      studentName: input.studentName ?? null,
      notes: input.notes ?? null,
    })
    // Two messages arriving together: the second finds the first's lead.
    .onConflictDoNothing()
    .returning()
  if (!created) {
    const [row] = await db
      .select()
      .from(leads)
      .where(and(eq(leads.orgId, input.orgId), eq(leads.contactId, input.contactId)))
    return row ?? null
  }
  await db.insert(leadEvents).values({
    orgId: input.orgId,
    leadId: created.id,
    type: 'created',
    toStage: 'new',
    actor: input.actor,
    actorUserId: input.actor === 'user' ? input.actorUserId : null,
  })
  return { ...created, isNew: true }
}

/**
 * Moves a lead and writes the timeline entry. With `onlyForward`, the
 * automatic moves (bot, system) never drag a lead back, e.g. a demo booked
 * after admission. A lost lead that books a demo comes back to life.
 */
export async function moveLead(
  db: AnyDatabase,
  input: {
    orgId: string
    leadId: string
    to: LeadStage
    note?: string | null
    lostReason?: string | null
    onlyForward?: boolean
    type?: string
    now?: Date
  } & Actor,
): Promise<Lead | null> {
  const [lead] = await db
    .select()
    .from(leads)
    .where(and(eq(leads.id, input.leadId), eq(leads.orgId, input.orgId)))
  if (!lead) return null
  if (lead.stage === input.to) return lead
  if (input.onlyForward && lead.stage !== 'lost' && rank(input.to) < rank(lead.stage)) return lead

  const [updated] = await db
    .update(leads)
    .set({
      stage: input.to,
      stageChangedAt: input.now ?? new Date(),
      lostReason: input.to === 'lost' ? (input.lostReason ?? lead.lostReason) : null,
    })
    .where(eq(leads.id, lead.id))
    .returning()
  await db.insert(leadEvents).values({
    orgId: input.orgId,
    leadId: lead.id,
    type: input.type ?? 'stage',
    fromStage: lead.stage,
    toStage: input.to,
    actor: input.actor,
    actorUserId: input.actor === 'user' ? input.actorUserId : null,
    note: input.note ?? input.lostReason ?? null,
  })
  return updated ?? lead
}
