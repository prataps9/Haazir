import { eq, inArray } from 'drizzle-orm'
import { memberships, pushSubscriptions, type AnyDatabase, type NotifyPrefs } from '@haazir/db'

export interface PushPayload {
  title: string
  body: string
  /** Opened when the notification is tapped: deep link into the dashboard. */
  url: string
  tag?: string
}

/** Delivers one notification. `gone` means the browser unsubscribed: forget it. */
export interface PushSender {
  send(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: PushPayload,
  ): Promise<{ gone: boolean }>
}

/**
 * Notifies an org's staff (spec §11.6, §17): every device of every member
 * who hasn't switched this kind of notification off. Subscriptions the push
 * service says are gone are deleted.
 */
export async function notifyOrg(
  deps: { db: AnyDatabase; push: PushSender },
  orgId: string,
  kind: keyof NotifyPrefs,
  payload: PushPayload,
) {
  const members = await deps.db
    .select({ userId: memberships.userId, prefs: memberships.notifyPrefs })
    .from(memberships)
    .where(eq(memberships.orgId, orgId))
  const wanted = members.filter((m) => m.prefs?.[kind]?.push !== false).map((m) => m.userId)
  if (!wanted.length) return { sent: 0, removed: 0 }

  const subs = await deps.db
    .select()
    .from(pushSubscriptions)
    .where(inArray(pushSubscriptions.userId, wanted))
  let sent = 0
  const gone: string[] = []
  await Promise.all(
    subs.map(async (sub) => {
      try {
        const result = await deps.push.send({ endpoint: sub.endpoint, keys: sub.keys }, payload)
        if (result.gone) gone.push(sub.id)
        else sent++
      } catch {
        /* one failing device doesn't stop the others */
      }
    }),
  )
  if (gone.length)
    await deps.db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, gone))
  return { sent, removed: gone.length }
}

/**
 * The real sender: Web Push with VAPID (no Play Store app needed, spec §17).
 * 404/410 from the push service means the subscription is dead.
 */
export async function createWebPushSender(config: {
  publicKey: string
  privateKey: string
  subject: string
}): Promise<PushSender> {
  const webpush = (await import('web-push')).default
  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey)
  return {
    async send(subscription, payload) {
      try {
        await webpush.sendNotification(subscription, JSON.stringify(payload), {
          TTL: 60 * 60,
          urgency: 'high',
        })
        return { gone: false }
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode
        if (status === 404 || status === 410) return { gone: true }
        throw err
      }
    },
  }
}
