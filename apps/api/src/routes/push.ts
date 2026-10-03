import { Router } from 'express'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { pushSubscriptions } from '@haazir/db'
import type { AppDeps } from '../deps'
import { userOf } from '../lib/http'

/** Web Push subscriptions (spec §17): one per browser or phone. */
export function pushRouter(deps: Pick<AppDeps, 'db' | 'vapidPublicKey'>) {
  const router = Router()

  router.get('/push/public-key', (_req, res) => {
    res.json({ publicKey: deps.vapidPublicKey ?? null })
  })

  router.post('/push/subscribe', async (req, res) => {
    const user = userOf(req)
    const body = z
      .object({
        endpoint: z.url().refine((u) => u.startsWith('https://'), 'Push endpoints are https'),
        keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
        deviceLabel: z.string().trim().max(60).optional(),
      })
      .parse(req.body)
    await deps.db
      .insert(pushSubscriptions)
      .values({
        userId: user.id,
        endpoint: body.endpoint,
        keys: body.keys,
        deviceLabel: body.deviceLabel,
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { userId: user.id, keys: body.keys, deviceLabel: body.deviceLabel },
      })
    res.status(201).json({ ok: true })
  })

  router.delete('/push/subscribe', async (req, res) => {
    const { endpoint } = z.object({ endpoint: z.string() }).parse(req.body)
    await deps.db
      .delete(pushSubscriptions)
      .where(
        and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, userOf(req).id)),
      )
    res.status(204).end()
  })

  return router
}
