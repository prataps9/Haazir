import { and, eq } from 'drizzle-orm'
import {
  contacts,
  courses,
  feeInstallments,
  orgPaymentAccounts,
  students,
  type AnyDatabase,
} from '@haazir/db'
import { decryptSecret } from '@haazir/shared/crypto'
import {
  createRazorpay,
  RazorpayError,
  type RazorpayClient,
  type RazorpayCredentials,
} from './razorpay'

export type RazorpayFactory = (credentials: RazorpayCredentials) => RazorpayClient

export type PaymentLinkResult =
  | { ok: true; url: string; created: boolean }
  | { ok: false; reason: 'not_found' | 'paid' | 'no_account' | 'provider_error'; message?: string }

/**
 * A Razorpay payment link for one installment, on the institute's own
 * account (spec §16.7). Reuses the link already made; creates one otherwise.
 * The installment id is Razorpay's reference_id, so their side refuses a
 * second link for the same installment even if ours crashed mid-way.
 */
export async function ensurePaymentLink(
  db: AnyDatabase,
  input: {
    orgId: string
    installmentId: string
    encryptionKey: string | undefined
    razorpay?: RazorpayFactory
  },
): Promise<PaymentLinkResult> {
  const [row] = await db
    .select({ installment: feeInstallments, student: students, contact: contacts, course: courses })
    .from(feeInstallments)
    .innerJoin(students, eq(students.id, feeInstallments.studentId))
    .innerJoin(contacts, eq(contacts.id, students.contactId))
    .leftJoin(courses, eq(courses.id, students.courseId))
    .where(and(eq(feeInstallments.id, input.installmentId), eq(feeInstallments.orgId, input.orgId)))
  if (!row) return { ok: false, reason: 'not_found' }
  const { installment, student, contact, course } = row
  if (installment.status === 'paid' || installment.status === 'waived')
    return { ok: false, reason: 'paid' }
  if (installment.paymentLinkUrl)
    return { ok: true, url: installment.paymentLinkUrl, created: false }

  const [account] = await db
    .select()
    .from(orgPaymentAccounts)
    .where(
      and(eq(orgPaymentAccounts.orgId, input.orgId), eq(orgPaymentAccounts.status, 'connected')),
    )
  if (!account || !input.encryptionKey) return { ok: false, reason: 'no_account' }

  const client = (input.razorpay ?? createRazorpay)({
    keyId: account.keyId,
    keySecret: decryptSecret(account.keySecretEnc, input.encryptionKey),
  })
  try {
    const link = await client.createPaymentLink({
      amountPaise: installment.amountPaise,
      description: `${course?.shortName ?? 'Fees'}: ${installment.label} (${student.name})`,
      referenceId: installment.id,
      customer: { name: student.name, phone: contact.waId },
      notes: { installment_id: installment.id, org_id: input.orgId },
    })
    await db
      .update(feeInstallments)
      .set({ paymentLinkId: link.id, paymentLinkUrl: link.shortUrl })
      .where(eq(feeInstallments.id, installment.id))
    return { ok: true, url: link.shortUrl, created: true }
  } catch (err) {
    if (err instanceof RazorpayError) {
      await db
        .update(orgPaymentAccounts)
        .set(
          err.status === 401
            ? { status: 'error', lastError: err.message }
            : { lastError: err.message },
        )
        .where(eq(orgPaymentAccounts.id, account.id))
      return { ok: false, reason: 'provider_error', message: err.message }
    }
    throw err
  }
}
