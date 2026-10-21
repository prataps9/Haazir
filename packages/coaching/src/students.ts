import { and, eq, sql } from 'drizzle-orm'
import { batches, courses, feeInstallments, leads, students, type AnyDatabase } from '@haazir/db'
import { AppError, feeStatusOn, scheduleInstallments } from '@haazir/shared'
import { moveLead, type Actor } from './leads'

export type Student = typeof students.$inferSelect
export type Installment = typeof feeInstallments.$inferSelect

/**
 * Admission (spec §16.5 → Admitted): creates the student, their installments
 * from the course plan, fills a seat in the batch, and moves the lead.
 */
export async function admitStudent(
  db: AnyDatabase,
  input: {
    orgId: string
    contactId: string
    name: string
    courseId: string
    batchId?: string | null
    admissionDate: string
    today: string
    guardianContactId?: string | null
    rollNo?: string | null
  } & Actor,
): Promise<{ student: Student; installments: Installment[] }> {
  const [course] = await db
    .select()
    .from(courses)
    .where(and(eq(courses.id, input.courseId), eq(courses.orgId, input.orgId)))
  if (!course) throw new AppError('NOT_FOUND', 'Course not found')
  if (input.batchId) {
    const [batch] = await db
      .select({ id: batches.id })
      .from(batches)
      .where(and(eq(batches.id, input.batchId), eq(batches.orgId, input.orgId)))
    if (!batch) throw new AppError('NOT_FOUND', 'Batch not found')
  }

  const [lead] = await db
    .select()
    .from(leads)
    .where(and(eq(leads.orgId, input.orgId), eq(leads.contactId, input.contactId)))

  const [student] = await db
    .insert(students)
    .values({
      orgId: input.orgId,
      contactId: input.contactId,
      leadId: lead?.id,
      name: input.name,
      courseId: course.id,
      batchId: input.batchId ?? null,
      admissionDate: input.admissionDate,
      guardianContactId: input.guardianContactId ?? null,
      rollNo: input.rollNo ?? null,
    })
    .returning()

  const plan = course.installmentPlan.length
    ? course.installmentPlan
    : [{ label: 'Poori fees', amountPaise: course.feeTotalPaise, dueOffsetDays: 0 }]
  const installments = await db
    .insert(feeInstallments)
    .values(
      scheduleInstallments(plan, input.admissionDate).map((i) => ({
        ...i,
        orgId: input.orgId,
        studentId: student!.id,
        status: feeStatusOn({ dueDate: i.dueDate, status: 'upcoming' }, input.today),
      })),
    )
    .returning()

  if (input.batchId) {
    await db
      .update(batches)
      .set({ seatsFilled: sql`${batches.seatsFilled} + 1` })
      .where(eq(batches.id, input.batchId))
  }
  if (lead) {
    await moveLead(db, {
      orgId: input.orgId,
      leadId: lead.id,
      to: 'admitted',
      type: 'admitted',
      note: course.shortName,
      ...(input.actor === 'user'
        ? { actor: 'user' as const, actorUserId: input.actorUserId }
        : { actor: input.actor }),
    })
  }
  return { student: student!, installments }
}
