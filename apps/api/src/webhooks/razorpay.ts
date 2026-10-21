import express, { Router } from 'express'
import { and, eq } from 'drizzle-orm'
import { parsePaymentLinkPaid, recordPayment, verifyRazorpaySignature } from '@haazir/coaching'
import { feeInstallments, orgPaymentAccounts, students } from '@haazir/db'
import { announceMessage, sendAutomation } from '@haazir/messaging'
import { AppError, formatPaise } from '@haazir/shared'
import { decryptSecret } from '@haazir/shared/crypto'
import type { AppDeps } from '../deps'

/**
 * POST /webhooks/razorpay/org/:orgId (spec §9): the institute's Razorpay tells
 * us a fee link was paid. Checked against that org's own webhook secret over
 * the raw body; then the installment is marked paid and a receipt goes out
 * on WhatsApp. Razorpay retries until it gets a 2xx, and recordPayment counts
 * a payment once, so a retry never sends a second receipt.
 */
export function razorpayWebhookRouter(
  deps: Pick<AppDeps, 'db' | 'encryptionKey' | 'queues' | 'events' | 'now'>,
) {
  const router = Router()
  router.post(
    '/webhooks/razorpay/org/:orgId',
    express.raw({ type: '*/*', limit: '1mb' }),
    async (req, res, next) => {
      try {
        const orgId = String(req.params.orgId)
        if (!/^[0-9a-f-]{36}$/.test(orgId)) throw new AppError('NOT_FOUND', 'Unknown organisation')
        const [account] = await deps.db
          .select()
          .from(orgPaymentAccounts)
          .where(eq(orgPaymentAccounts.orgId, orgId))
        if (!account || !deps.encryptionKey) throw new AppError('NOT_FOUND', 'Payments not set up')

        const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
        const secret = decryptSecret(account.webhookSecretEnc, deps.encryptionKey)
        if (!verifyRazorpaySignature(raw, req.get('x-razorpay-signature'), secret)) {
          req.log.warn({ orgId, ip: req.ip }, 'razorpay signature mismatch')
          throw new AppError('UNAUTHENTICATED', 'Invalid signature')
        }

        let body: unknown
        try {
          body = JSON.parse(raw.toString('utf8'))
        } catch {
          throw new AppError('VALIDATION', 'Body is not valid JSON')
        }
        const paid = parsePaymentLinkPaid(body)
        // Other events (payment.captured, link expired…) are fine to ignore.
        if (!paid) return void res.json({ ok: true, ignored: true })

        const [inst] = await deps.db
          .select({ id: feeInstallments.id, contactId: students.contactId })
          .from(feeInstallments)
          .innerJoin(students, eq(students.id, feeInstallments.studentId))
          .where(
            and(
              eq(feeInstallments.orgId, orgId),
              eq(feeInstallments.paymentLinkId, paid.paymentLinkId),
            ),
          )
        if (!inst) {
          req.log.warn({ orgId, link: paid.paymentLinkId }, 'payment for an unknown link')
          return void res.json({ ok: true, ignored: true })
        }

        const result = await recordPayment(deps.db, {
          orgId,
          installmentId: inst.id,
          via: 'razorpay',
          paidAt: paid.paidAt,
        })
        if (result && !result.alreadyPaid) {
          const receipt = await sendAutomation(
            { db: deps.db, outboundQueue: deps.queues.outbound },
            {
              orgId,
              contactId: inst.contactId,
              purpose: 'payment_received',
              values: [
                formatPaise(result.installment.amountPaise).replace('₹', ''),
                result.installment.receiptNo!,
              ],
              urgent: true,
              sentBy: 'system',
              now: deps.now(),
            },
          )
          if (receipt.sent)
            await announceMessage(deps.db, deps.events, orgId, receipt.message.id, 'message:new')
          deps.events.emit(orgId, 'fee:updated', { installmentId: inst.id })
        }
        res.json({ ok: true })
      } catch (err) {
        next(err)
      }
    },
  )
  return router
}
