/**
 * Phase 5's "done when", end to end on real Postgres, Redis, the API and the
 * worker, with the mock standing in for Meta:
 *
 *   templates submitted → approved by Meta's webhook → a campaign to 50
 *   opted-in contacts, sent throttled, never to the 5 who said STOP or never
 *   said yes → delivered → actual cost equals the estimate → Reports shows it.
 *
 * Run by scripts/e2e-campaign.sh, which starts everything first.
 */
import { createDb } from '@haazir/db'
import { CAMPAIGN_SEND_INTERVAL_MS, costPaise } from '@haazir/shared'
import { loadEnv } from '@haazir/shared/env'

const env = loadEnv()
const run = String(Date.now()).slice(-6)
const TAG = `e2e${run}`
const { pool, close } = createDb(env.DATABASE_URL, { max: 2 })
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  (await pool.query(sql, params)).rows as T[]

let step = 0
function check(ok: unknown, what: string): asserts ok {
  step++
  if (!ok) {
    console.error(`✗ ${step}. ${what}`)
    process.exit(1)
  }
  console.log(`✓ ${step}. ${what}`)
}

async function waitFor<T>(
  fn: () => Promise<T | null | undefined | false>,
  what: string,
  ms = 30_000,
) {
  const until = Date.now() + ms
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() > until) {
      console.error(`✗ timed out waiting for: ${what}`)
      process.exit(1)
    }
    await new Promise((r) => setTimeout(r, 500))
  }
}

// ---- The owner, through the real API ----
const login = await fetch(`${env.API_URL}/api/v1/auth/sign-in/email`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: env.APP_URL },
  body: JSON.stringify({ email: 'rakesh@shiksha.example', password: 'haazir-demo-2026' }),
})
const cookie = login.headers
  .getSetCookie()
  .map((c) => c.split(';')[0])
  .join('; ')
const me = (await (await fetch(`${env.API_URL}/api/v1/me`, { headers: { cookie } })).json()) as {
  orgs: { id: string }[]
}
const orgId = me.orgs[0]!.id
const owner = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
  const res = await fetch(`${env.API_URL}/api/v1${path}`, {
    method,
    headers: { cookie, 'x-org-id': orgId, 'content-type': 'application/json', origin: env.APP_URL },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = (await res.json().catch(() => null)) as T
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json)}`)
  return json
}
check(login.ok && orgId, 'owner logged in')

// ---- 1. Templates: submitted, approved by Meta's webhook ----
type T = { id: string; name: string; status: string }
const before = await owner<{ templates: T[] }>('GET', '/templates')
const announcement = before.templates.find((x) => x.name === 'announcement_hinglish')!
if (announcement.status === 'draft') {
  const r = await owner<{ submitted: number }>('POST', '/templates/submit-all')
  check(r.submitted > 0, `${r.submitted} draft templates sent to Meta`)
}
await waitFor(
  async () =>
    (await owner<{ templates: T[] }>('GET', '/templates')).templates.find(
      (x) => x.id === announcement.id && x.status === 'approved',
    ),
  'Meta to approve the announcement',
)
check(true, 'Meta’s webhook approved the announcement template')

// ---- 2. 55 contacts: 50 said yes, 3 sent STOP, 2 never said ----
const phone = (i: number) => `9197${run}${String(i).padStart(4, '0')}`
const status = (i: number) => (i < 50 ? 'opted_in' : i < 53 ? 'opted_out' : 'unknown')
for (let i = 0; i < 55; i++)
  await q(
    `insert into contacts (org_id, wa_id, name, tags, opt_in_status, opt_in_source, opt_in_at)
     values ($1, $2, $3, $4, $5, $6, now())`,
    [orgId, phone(i), `Parent ${i}`, [TAG], status(i), status(i) === 'opted_in' ? 'staff' : null],
  )
const count = await owner<{ count: number; optedOut: number; noConsent: number }>(
  'POST',
  '/campaigns/audience-count',
  { audience: { tags: [TAG] } },
)
check(
  count.count === 50 && count.optedOut === 3 && count.noConsent === 2,
  `audience: ${count.count} will get it, ${count.optedOut} STOP and ${count.noConsent} without consent left out`,
)

// ---- 3. The campaign: estimate, send ----
const draft = await owner<{ id: string }>('POST', '/campaigns', {
  name: `E2E ${run}`,
  templateId: announcement.id,
  audience: { tags: [TAG] },
  variableMap: [
    { source: 'custom', text: 'RS-CIT Shaam' },
    { source: 'custom', text: '1 Nov' },
  ],
})
const estimate = await owner<{ recipients: number; costPaise: number; category: string }>(
  'POST',
  `/campaigns/${draft.id}/estimate`,
)
check(
  estimate.recipients === 50 &&
    estimate.category === 'marketing' &&
    estimate.costPaise === costPaise(50, 8631),
  `estimate: 50 marketing messages, ₹${estimate.costPaise / 100} + GST`,
)
const started = Date.now()
await owner('POST', `/campaigns/${draft.id}/schedule`, {})

type Results = {
  status: string
  estimatedCostPaise: number
  results: { delivered: number; failed: number; actualCostPaise: number } | null
}
const done = await waitFor(
  async () => {
    const c = await owner<Results>('GET', `/campaigns/${draft.id}`)
    return c.status === 'done' && c.results?.delivered === 50 ? c : null
  },
  'all 50 delivered',
  90_000,
)
const took = Date.now() - started
check(true, `all 50 delivered in ${(took / 1000).toFixed(1)}s`)
check(
  took >= 49 * CAMPAIGN_SEND_INTERVAL_MS,
  `throttled: no faster than one message every ${CAMPAIGN_SEND_INTERVAL_MS} ms`,
)

const outTo = await q<{ wa_id: string }>(
  `select k.wa_id from campaign_recipients r join contacts k on k.id = r.contact_id
   where r.campaign_id = $1`,
  [draft.id],
)
check(
  outTo.length === 50 && outTo.every((r) => Number(r.wa_id.slice(-4)) < 50),
  'nobody who sent STOP or never said yes was messaged',
)
check(
  done.results!.actualCostPaise === done.estimatedCostPaise,
  `actual cost ₹${done.results!.actualCostPaise / 100} = estimate ₹${done.estimatedCostPaise / 100}`,
)

// ---- 4. Reports ----
const report = await owner<{ costs: { category: string; billable: number }[] }>(
  'GET',
  '/analytics/report?days=7',
)
const marketing = report.costs.find((c) => c.category === 'marketing')
check(
  (marketing?.billable ?? 0) >= 50,
  `Reports: ${marketing?.billable} marketing messages charged this week`,
)

await close()
console.log('E2E campaign passed.')
