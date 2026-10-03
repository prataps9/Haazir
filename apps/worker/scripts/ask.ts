/**
 * The test box (spec §12) on the command line: ask the bot something and see
 * its answer, what it understood, which tools and documents it used, and
 * whether the guardrails objected. Nothing is sent to WhatsApp.
 *
 *   pnpm bot:ask "RSCIT ki fees kitni hai bhaiya"
 *   pnpm bot:ask "RS-CIT की फीस कितनी है?"
 */
import { eq } from 'drizzle-orm'
import { askInPlayground, createModels } from '@haazir/ai-core'
import { createDb, organizations } from '@haazir/db'
import { loadEnv } from '@haazir/shared/env'

const env = loadEnv()
const question = process.argv.slice(2).join(' ').trim()
if (!question) {
  console.error('Usage: pnpm bot:ask "your question"')
  process.exit(1)
}

const { db, close } = createDb(env.DATABASE_URL, { max: 2 })
try {
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, env.WHATSAPP_ORG_SLUG))
  if (!org) throw new Error('Run pnpm db:seed first.')

  const { decision, sources } = await askInPlayground(
    { db, models: createModels(env), now: () => new Date() },
    { orgId: org.id, ownerKey: 'cli', question },
  )

  console.log(
    `\n${decision.kind.toUpperCase()}${'reason' in decision ? ` (${decision.reason})` : ''}`,
  )
  if ('content' in decision) {
    console.log(`\n${decision.content.body}`)
    if (decision.content.kind === 'buttons')
      console.log(decision.content.buttons.map((b) => `[ ${b.title} ]`).join(' '))
  }
  if ('trace' in decision) {
    const t = decision.trace
    console.log(`\nUnderstood: ${t.intent} · ${t.language} · confidence ${t.confidence}`)
    console.log(`Tools: ${t.toolCalls.map((c) => c.name).join(', ') || 'none'}`)
    if (sources.length) {
      console.log('Sources used:')
      for (const c of sources) console.log(`  - ${c.content.replace(/\s+/g, ' ').slice(0, 90)}`)
    }
    if (t.guardrailFlags.length) console.log(`Guardrails: ${t.guardrailFlags.join(', ')}`)
    console.log(
      `${t.latencyMs} ms · ${t.inputTokens} in / ${t.outputTokens} out tokens · ${t.model}\n`,
    )
  }
} catch (err) {
  console.error((err as Error).message)
  process.exitCode = 1
} finally {
  await close()
}
