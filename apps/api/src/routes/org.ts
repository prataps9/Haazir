import { Router } from 'express'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { createRazorpay, RazorpayError } from '@haazir/coaching'
import { orgPaymentAccounts, organizations, whatsappAccounts } from '@haazir/db'
import { AppError, LANGUAGES } from '@haazir/shared'
import { encryptSecret } from '@haazir/shared/crypto'
import { requireRole } from '../auth/middleware'
import type { AppDeps } from '../deps'
import { audit, orgOf } from '../lib/http'

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm, e.g. 08:00')
const day = z.object({ open: hhmm, close: hhmm }).nullable()
const businessHours = z.object({
  mon: day,
  tue: day,
  wed: day,
  thu: day,
  fri: day,
  sat: day,
  sun: day,
})

const orgPatch = z
  .object({
    name: z.string().trim().min(2).max(120),
    city: z.string().trim().min(2).max(60),
    state: z.string().trim().max(60).nullable(),
    address: z.string().trim().max(300).nullable(),
    mapsUrl: z.url().nullable(),
    latitude: z.number().min(-90).max(90).nullable(),
    longitude: z.number().min(-180).max(180).nullable(),
    phone: z
      .string()
      .regex(/^\d{10,15}$/, 'Digits only, with the country code: 91…')
      .nullable(),
    defaultLanguage: z.enum(LANGUAGES),
    businessHours,
    displayName: z.string().trim().min(1).max(60),
  })
  .partial()

const view = (o: typeof organizations.$inferSelect) => ({
  id: o.id,
  name: o.name,
  displayName: o.brand?.displayName ?? o.name,
  city: o.city,
  state: o.state,
  address: o.address,
  mapsUrl: o.mapsUrl,
  latitude: o.latitude,
  longitude: o.longitude,
  phone: o.phone,
  defaultLanguage: o.defaultLanguage,
  businessHours: o.businessHours,
  status: o.status,
  onboardingStep: o.onboardingStep,
})

/** The institute's own details (spec §9 /org, §16.2 onboarding, §16.7 payment setup). */
export function orgRouter(deps: Pick<AppDeps, 'db' | 'encryptionKey' | 'razorpay' | 'apiUrl'>) {
  const { db } = deps
  const router = Router()
  const admins = requireRole('owner', 'admin')

  const load = async (id: string) => {
    const [org] = await db.select().from(organizations).where(eq(organizations.id, id))
    if (!org) throw new AppError('NOT_FOUND', 'Organisation not found')
    return org
  }

  router.get('/org', async (req, res) => {
    const org = await load(orgOf(req).id)
    const [wa] = await db
      .select({
        status: whatsappAccounts.status,
        displayPhone: whatsappAccounts.displayPhone,
        verifiedName: whatsappAccounts.verifiedName,
        qualityRating: whatsappAccounts.qualityRating,
      })
      .from(whatsappAccounts)
      .where(eq(whatsappAccounts.orgId, org.id))
      .limit(1)
    const [pay] = await db
      .select({ status: orgPaymentAccounts.status })
      .from(orgPaymentAccounts)
      .where(eq(orgPaymentAccounts.orgId, org.id))
    res.json({ ...view(org), whatsapp: wa ?? null, paymentsConnected: pay?.status === 'connected' })
  })

  router.patch('/org', admins, async (req, res) => {
    const org = await load(orgOf(req).id)
    const { displayName, ...body } = orgPatch.parse(req.body)
    await db
      .update(organizations)
      .set({ ...body, ...(displayName ? { brand: { ...org.brand, displayName } } : {}) })
      .where(eq(organizations.id, org.id))
    await audit(db, req, {
      action: 'org.updated',
      entity: 'organization',
      entityId: org.id,
      diff: req.body,
    })
    res.json(view(await load(org.id)))
  })

  /** The wizard saves each step (spec §16.2: resumable). */
  router.patch('/org/onboarding', admins, async (req, res) => {
    const { step, done } = z
      .object({ step: z.number().int().min(0).max(8), done: z.boolean().optional() })
      .parse(req.body)
    const org = await load(orgOf(req).id)
    await db
      .update(organizations)
      .set({
        onboardingStep: Math.max(step, org.onboardingStep),
        ...(done ? { status: 'active' as const } : {}),
      })
      .where(eq(organizations.id, org.id))
    if (done)
      await audit(db, req, { action: 'org.went_live', entity: 'organization', entityId: org.id })
    res.json(view(await load(org.id)))
  })

  // ---- The institute's own Razorpay (fees go straight to them) ----

  router.get('/org/payments', admins, async (req, res) => {
    const org = orgOf(req)
    const [account] = await db
      .select()
      .from(orgPaymentAccounts)
      .where(eq(orgPaymentAccounts.orgId, org.id))
    res.json({
      connected: account?.status === 'connected',
      keyId: account?.keyId ?? null,
      status: account?.status ?? null,
      lastError: account?.lastError ?? null,
      // Pasted into Razorpay > Settings > Webhooks, event payment_link.paid.
      webhookUrl: `${deps.apiUrl.replace(/\/$/, '')}/webhooks/razorpay/org/${org.id}`,
    })
  })

  /** Connect: the keys are checked against Razorpay before anything is saved. */
  router.put('/org/payments', requireRole('owner'), async (req, res) => {
    const org = orgOf(req)
    const body = z
      .object({
        keyId: z
          .string()
          .trim()
          .regex(/^rzp_(test|live)_\w+$/, 'Key id starts with rzp_live_ or rzp_test_'),
        keySecret: z.string().trim().min(10),
        webhookSecret: z
          .string()
          .trim()
          .min(8, 'Set a webhook secret in Razorpay and paste it here'),
      })
      .parse(req.body)
    if (!deps.encryptionKey)
      throw new AppError('UNAVAILABLE', 'ENCRYPTION_KEY is not set on the server')
    try {
      await (deps.razorpay ?? createRazorpay)({
        keyId: body.keyId,
        keySecret: body.keySecret,
      }).check()
    } catch (err) {
      if (err instanceof RazorpayError)
        throw new AppError('VALIDATION', `Razorpay said: ${err.message}`)
      throw err
    }
    const values = {
      keyId: body.keyId,
      keySecretEnc: encryptSecret(body.keySecret, deps.encryptionKey),
      webhookSecretEnc: encryptSecret(body.webhookSecret, deps.encryptionKey),
      status: 'connected' as const,
      lastError: null,
    }
    await db
      .insert(orgPaymentAccounts)
      .values({ orgId: org.id, ...values })
      .onConflictDoUpdate({ target: orgPaymentAccounts.orgId, set: values })
    await audit(db, req, {
      action: 'payments.connected',
      entity: 'org_payment_account',
      diff: { keyId: body.keyId },
    })
    res.json({ connected: true, keyId: body.keyId })
  })

  router.delete('/org/payments', requireRole('owner'), async (req, res) => {
    const org = orgOf(req)
    await db.delete(orgPaymentAccounts).where(eq(orgPaymentAccounts.orgId, org.id))
    await audit(db, req, { action: 'payments.disconnected', entity: 'org_payment_account' })
    res.status(204).end()
  })

  return router
}
