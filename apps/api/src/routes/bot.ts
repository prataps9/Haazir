import { Router } from 'express'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { askInPlayground } from '@haazir/ai-core'
import { botConfigs } from '@haazir/db'
import { requireRole } from '../auth/middleware'
import type { AppDeps } from '../deps'
import { audit, orgOf, userOf } from '../lib/http'
import { playgroundView } from './knowledge'

const localised = z.object({
  hi: z.string().max(1000).optional(),
  en: z.string().max(1000).optional(),
  hinglish: z.string().max(1000).optional(),
})
const keywords = z.array(z.string().trim().min(1).max(40)).max(30)

/** Bot settings (spec §16.11). The structure is fixed in code; owners edit texts and switches. */
const botPatch = z
  .object({
    personaName: z.string().trim().min(1).max(40),
    tone: z.enum(['warm', 'formal']),
    greeting: localised,
    // WhatsApp reply buttons: at most 3, titles at most 20 characters.
    mainMenu: z
      .array(
        z.object({
          id: z.enum(['menu_courses', 'menu_demo', 'menu_talk']),
          title: z.object({
            hi: z.string().max(20).optional(),
            en: z.string().max(20).optional(),
            hinglish: z.string().max(20).optional(),
          }),
        }),
      )
      .max(3),
    handoffKeywords: keywords,
    optoutKeywords: keywords.min(1, 'Keep at least one opt-out word, e.g. STOP'),
    afterHoursMessage: localised,
    fallbackMessage: localised,
    competitorNames: keywords,
    maxAiRepliesPerContactHour: z.number().int().min(1).max(100),
    enabled: z.boolean(),
  })
  .partial()

export function botRouter(deps: Pick<AppDeps, 'db' | 'models' | 'now'>) {
  const { db } = deps
  const router = Router()

  const load = async (orgId: string) => {
    await db.insert(botConfigs).values({ orgId }).onConflictDoNothing({ target: botConfigs.orgId })
    const [config] = await db.select().from(botConfigs).where(eq(botConfigs.orgId, orgId))
    return { ...config!, aiConfigured: !!deps.models }
  }

  router.get('/bot', async (req, res) => {
    res.json(await load(orgOf(req).id))
  })

  router.patch('/bot', requireRole('owner', 'admin'), async (req, res) => {
    const org = orgOf(req)
    const body = botPatch.parse(req.body)
    const before = await load(org.id)
    await db.update(botConfigs).set(body).where(eq(botConfigs.orgId, org.id))
    const changed = Object.fromEntries(
      Object.keys(body).map((k) => [
        k,
        { from: before[k as keyof typeof before], to: body[k as keyof typeof body] },
      ]),
    )
    await audit(db, req, {
      action: body.enabled === false ? 'bot.disabled' : 'bot.updated',
      entity: 'bot_config',
      diff: changed,
    })
    res.json(await load(org.id))
  })

  /** The settings page's playground: same as the test box, separate history per person. */
  router.post('/bot/playground', async (req, res) => {
    const org = orgOf(req)
    const { text, reset } = z
      .object({ text: z.string().trim().min(1).max(1000), reset: z.boolean().optional() })
      .parse(req.body)
    const result = await askInPlayground(
      { db, models: deps.models, now: deps.now },
      { orgId: org.id, ownerKey: `settings-${userOf(req).id}`, question: text, reset },
    )
    res.json(playgroundView(result))
  })

  return router
}
