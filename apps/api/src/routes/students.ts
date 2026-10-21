import { Router } from 'express'
import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { admitStudent } from '@haazir/coaching'
import { batches, contacts, courses, feeInstallments, students } from '@haazir/db'
import { AppError, STUDENT_STATUSES } from '@haazir/shared'
import type { AppDeps } from '../deps'
import { audit, orgOf, userOf, uuidParam } from '../lib/http'
import { istDate } from '../lib/time'

const phone = z
  .string()
  .transform((s) => s.replace(/[\s+\-()]/g, ''))
  .transform((s) => (/^\d{10}$/.test(s) ? `91${s}` : s))
  .refine((s) => /^\d{11,15}$/.test(s), 'A 10-digit mobile number, or with the country code')

/** Students (spec §8, §16.7 student detail): admitted people and what they owe. */
export function studentsRouter(deps: Pick<AppDeps, 'db' | 'events' | 'now'>) {
  const { db } = deps
  const router = Router()

  router.get('/students', async (req, res) => {
    const org = orgOf(req)
    const { q, course } = z
      .object({ q: z.string().trim().max(60).optional(), course: z.uuid().optional() })
      .parse(req.query)
    const like = q ? `%${q.replace(/[%_]/g, '')}%` : null
    const rows = await db
      .select({
        id: students.id,
        name: students.name,
        status: students.status,
        rollNo: students.rollNo,
        admissionDate: students.admissionDate,
        courseName: courses.shortName,
        batchName: batches.name,
        waId: contacts.waId,
        duePaise: sql<number>`coalesce(sum(${feeInstallments.amountPaise}) filter (where ${feeInstallments.status} in ('due','overdue')), 0)::int`,
        paidPaise: sql<number>`coalesce(sum(${feeInstallments.amountPaise}) filter (where ${feeInstallments.status} = 'paid'), 0)::int`,
        nextDue: sql<
          string | null
        >`min(${feeInstallments.dueDate}) filter (where ${feeInstallments.status} in ('upcoming','due','overdue'))`,
      })
      .from(students)
      .innerJoin(contacts, eq(contacts.id, students.contactId))
      .leftJoin(courses, eq(courses.id, students.courseId))
      .leftJoin(batches, eq(batches.id, students.batchId))
      .leftJoin(feeInstallments, eq(feeInstallments.studentId, students.id))
      .where(
        and(
          eq(students.orgId, org.id),
          course ? eq(students.courseId, course) : undefined,
          like
            ? or(
                ilike(students.name, like),
                ilike(contacts.waId, like),
                ilike(students.rollNo, like),
              )
            : undefined,
        ),
      )
      .groupBy(students.id, courses.shortName, batches.name, contacts.waId)
      .orderBy(desc(students.admissionDate))
      .limit(1000)
    res.json({ students: rows })
  })

  const own = async (orgId: string, id: string) => {
    const [row] = await db
      .select({ student: students, contact: contacts, course: courses, batch: batches })
      .from(students)
      .innerJoin(contacts, eq(contacts.id, students.contactId))
      .leftJoin(courses, eq(courses.id, students.courseId))
      .leftJoin(batches, eq(batches.id, students.batchId))
      .where(and(eq(students.id, id), eq(students.orgId, orgId)))
    if (!row) throw new AppError('NOT_FOUND', 'Student not found')
    return row
  }

  router.get('/students/:id', async (req, res) => {
    const org = orgOf(req)
    const { id } = uuidParam.parse(req.params)
    const row = await own(org.id, id)
    const [installments, guardian] = await Promise.all([
      db
        .select()
        .from(feeInstallments)
        .where(and(eq(feeInstallments.studentId, id), eq(feeInstallments.orgId, org.id)))
        .orderBy(asc(feeInstallments.dueDate)),
      row.student.guardianContactId
        ? db
            .select({ id: contacts.id, name: contacts.name, waId: contacts.waId })
            .from(contacts)
            .where(and(eq(contacts.id, row.student.guardianContactId), eq(contacts.orgId, org.id)))
        : Promise.resolve([]),
    ])
    res.json({
      ...row.student,
      contact: { id: row.contact.id, name: row.contact.name, waId: row.contact.waId },
      course: row.course && {
        id: row.course.id,
        shortName: row.course.shortName,
        feeTotalPaise: row.course.feeTotalPaise,
      },
      batch: row.batch && { id: row.batch.id, name: row.batch.name },
      guardian: guardian[0] ?? null,
      installments,
    })
  })

  /** A walk-in admission: the contact is found or created by phone number. */
  router.post('/students', async (req, res) => {
    const org = orgOf(req)
    const user = userOf(req)
    const today = istDate(deps.now())
    const body = z
      .object({
        name: z.string().trim().min(1).max(80),
        phone,
        courseId: z.uuid(),
        batchId: z.uuid().nullable().optional(),
        admissionDate: z.iso.date().default(today),
        guardianPhone: phone.optional(),
        rollNo: z.string().trim().max(30).optional(),
      })
      .parse(req.body)
    const contactFor = async (waId: string, name?: string) => {
      // Admission is consent to fee messages: an active transactional relationship (spec §13).
      await db
        .insert(contacts)
        .values({ orgId: org.id, waId, name, optInStatus: 'opted_in', optInSource: 'admission' })
        .onConflictDoNothing()
      const [c] = await db
        .select()
        .from(contacts)
        .where(and(eq(contacts.orgId, org.id), eq(contacts.waId, waId)))
      return c!
    }
    const contact = await contactFor(body.phone, body.name)
    const guardian = body.guardianPhone ? await contactFor(body.guardianPhone) : null
    const result = await admitStudent(db, {
      orgId: org.id,
      contactId: contact.id,
      name: body.name,
      courseId: body.courseId,
      batchId: body.batchId,
      admissionDate: body.admissionDate,
      guardianContactId: guardian?.id,
      rollNo: body.rollNo,
      today,
      actor: 'user',
      actorUserId: user.id,
    })
    await audit(db, req, {
      action: 'student.admitted',
      entity: 'student',
      entityId: result.student.id,
    })
    deps.events.emit(org.id, 'fee:updated', { studentId: result.student.id })
    res.status(201).json(result)
  })

  router.patch('/students/:id', async (req, res) => {
    const org = orgOf(req)
    const { id } = uuidParam.parse(req.params)
    await own(org.id, id)
    const body = z
      .object({
        name: z.string().trim().min(1).max(80),
        batchId: z.uuid().nullable(),
        rollNo: z.string().trim().max(30).nullable(),
        status: z.enum(STUDENT_STATUSES),
      })
      .partial()
      .parse(req.body)
    if (body.batchId) {
      const [b] = await db
        .select({ id: batches.id })
        .from(batches)
        .where(and(eq(batches.id, body.batchId), eq(batches.orgId, org.id)))
      if (!b) throw new AppError('VALIDATION', 'No such batch')
    }
    await db.update(students).set(body).where(eq(students.id, id))
    await audit(db, req, { action: 'student.updated', entity: 'student', entityId: id, diff: body })
    res.json((await own(org.id, id)).student)
  })

  return router
}
