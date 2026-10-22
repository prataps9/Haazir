/**
 * Phase 4's "done when", end to end on real Postgres, Redis, the built API
 * and worker, with the mock standing in for Meta and Razorpay:
 *
 *   enquiry on WhatsApp → demo booked by taps → reminder received → staff
 *   mark attended → admitted → installment link sent → paid (Razorpay
 *   webhook) → receipt message → Home shows it.
 *
 * Run by scripts/e2e-coaching.sh, which starts everything first.
 */
import { createHmac } from 'node:crypto'
import { Queue } from 'bullmq'
import { Redis } from 'ioredis'
import { createDb } from '@haazir/db'
import { QUEUES } from '@haazir/shared'
import { loadEnv } from '@haazir/shared/env'
import { signBody } from '@haazir/whatsapp'

const env = loadEnv()
const FROM = `9199${String(Date.now()).slice(-8)}`
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
  ms = 20_000,
) {
  const until = Date.now() + ms
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() > until) {
      console.error(`✗ timed out waiting for: ${what}`)
      process.exit(1)
    }
    await new Promise((r) => setTimeout(r, 300))
  }
}

/** One signed inbound message, as Meta would post it: text, or a tapped button / list row. */
async function say(text: string, tap?: { id: string; list?: boolean }) {
  const before = await outCount()
  const message = tap
    ? {
        type: 'interactive',
        interactive: tap.list
          ? { type: 'list_reply', list_reply: { id: tap.id, title: text } }
          : { type: 'button_reply', button_reply: { id: tap.id, title: text } },
      }
    : { type: 'text', text: { body: text } }
  const body = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'e2e',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '910000000000',
                phone_number_id: env.WHATSAPP_PHONE_NUMBER_ID,
              },
              contacts: [{ profile: { name: 'Ravi Meena' }, wa_id: FROM }],
              messages: [
                {
                  from: FROM,
                  id: `wamid.E2E${Date.now()}${Math.random()}`,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  ...message,
                },
              ],
            },
          },
        ],
      },
    ],
  })
  const res = await fetch(`${env.API_URL}/webhooks/whatsapp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': signBody(body, env.META_APP_SECRET!),
    },
    body,
  })
  if (res.status !== 200) throw new Error(`webhook answered ${res.status}`)
  // The bot's answer: every reply to this message has been written once the count stops growing.
  await waitFor(async () => (await outCount()) > before, `a reply to "${text}"`)
  await new Promise((r) => setTimeout(r, 600))
  return lastOut()
}

interface Content {
  kind: string
  body?: string
  buttons?: { id: string; title: string }[]
  sections?: { rows: { id: string; title: string }[] }[]
}
const outCount = async () =>
  Number(
    (
      await q<{ n: string }>(
        `select count(*) n from messages m join conversations c on c.id = m.conversation_id
         join contacts k on k.id = c.contact_id where k.wa_id = $1 and m.direction = 'out'`,
        [FROM],
      )
    )[0]!.n,
  )
const lastOut = async () =>
  (
    await q<{ content: Content; body: string | null; status: string }>(
      `select m.interactive->'content' content, m.body, m.status from messages m
       join conversations c on c.id = m.conversation_id join contacts k on k.id = c.contact_id
       where k.wa_id = $1 and m.direction = 'out' order by m.created_at desc limit 1`,
      [FROM],
    )
  )[0]!
const rows = (c: Content) => c.sections?.flatMap((s) => s.rows) ?? []

// ---- Staff, through the real API ----
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
  orgs: { id: string; name: string }[]
}
const orgId = me.orgs[0]!.id
const staff = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
  const res = await fetch(`${env.API_URL}/api/v1${path}`, {
    method,
    headers: { cookie, 'x-org-id': orgId, 'content-type': 'application/json', origin: env.APP_URL },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = (await res.json().catch(() => null)) as T
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json)}`)
  return json
}
check(login.ok && orgId, 'staff logged in through Better Auth')

// ---- 1. The enquiry, and a demo booked by taps ----
const menu = await say('Namaste')
check(
  menu.content.buttons?.some((b) => b.id === 'menu_demo'),
  'a new enquiry gets the main menu',
)
const [lead] = await q<{ id: string; stage: string }>(
  `select l.id, l.stage from leads l join contacts k on k.id = l.contact_id where k.wa_id = $1`,
  [FROM],
)
check(lead?.stage === 'new', 'and is a new lead, from its first message')

let reply = await say('Free demo', { id: 'menu_demo' })
const rscit = rows(reply.content).find((r) => r.title === 'RS-CIT')
check(rscit, 'the bot lists the courses that have demo slots')
reply = await say('RS-CIT', { id: rscit.id, list: true })
const day = rows(reply.content)[0]
check(day && day.id.startsWith('demo_day:'), `it offers days (${rows(reply.content).length})`)
reply = await say(day.title, { id: day.id, list: true })
if (rows(reply.content)[0]?.id.startsWith('demo_slot:')) {
  const slot = rows(reply.content)[0]!
  reply = await say(slot.title, { id: slot.id, list: true })
}
check(
  reply.content.buttons?.[0]?.id === 'demo_name',
  'it asks for the student, offering the WhatsApp name',
)
reply = await say('Ravi Meena', { id: 'demo_name' })
check(reply.content.buttons?.[0]?.id === 'demo_yes', 'it shows the booking to confirm')
reply = await say('Haan, book karo', { id: 'demo_yes' })
check(reply.body?.includes('book ho gayi'), `confirmation sent: "${reply.body?.split('\n')[0]}"`)

const booking = await waitFor(
  async () =>
    (
      await q<{ id: string; status: string }>(
        `select d.id, d.status from demo_bookings d join contacts k on k.id = d.contact_id where k.wa_id = $1`,
        [FROM],
      )
    )[0],
  'the booking',
)
check(booking.status === 'booked', 'one demo booking in the database')
check(
  (await q(`select stage from leads where id = $1`, [lead.id]))[0]!.stage === 'demo_booked',
  'the lead moved to demo booked',
)

// ---- 2. The reminder (a delayed job; promoted here instead of waiting hours) ----
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null })
const reminders = new Queue(QUEUES.reminder, { connection })
const job = await reminders.getJob(`demo-reminder-${booking.id}`)
check(job, 'a reminder is scheduled 3 hours before the class')
check(await reminders.getJob(`demo-followup-${booking.id}`), 'and a follow-up a day after')
await job.promote()
await waitFor(
  async () =>
    (await q(`select 1 from demo_bookings where id = $1 and status = 'reminded'`, [booking.id]))
      .length,
  'the reminder to go out',
)
check((await lastOut()).body?.startsWith('Yaad dilana tha'), 'the reminder arrived on WhatsApp')
await reminders.close()
await connection.quit()

// ---- 3. Staff: came, admitted ----
await staff('PATCH', `/demos/${booking.id}`, { status: 'attended' })
check(
  (await q(`select stage from leads where id = $1`, [lead.id]))[0]!.stage === 'demo_done',
  'staff marked "came": demo done',
)
const courses = await staff<{ courses: { id: string; shortName: string }[] }>('GET', '/courses')
const admit = await staff<{
  student: { id: string }
  installments: { id: string; amountPaise: number; status: string }[]
}>('POST', `/leads/${lead.id}/admit`, {
  name: 'Ravi Meena',
  courseId: courses.courses.find((c) => c.shortName === 'RS-CIT')!.id,
})
const inst = admit.installments[0]!
check(
  inst.status === 'due' && inst.amountPaise === 450000,
  'admitted: the ₹4,500 installment is due today',
)

// ---- 4. Payment link, paid, receipt ----
await staff('PUT', '/org/payments', {
  keyId: 'rzp_test_e2e123',
  keySecret: 'e2e-key-secret-1',
  webhookSecret: 'e2e-webhook-secret',
})
const sent = await staff<{ sent: boolean; link: string }>('POST', `/fees/${inst.id}/link`, {})
check(
  sent.sent && sent.link.startsWith('https://rzp.io/'),
  `the payment link went on WhatsApp: ${sent.link}`,
)
const [{ payment_link_id: linkId }] = (await q<{ payment_link_id: string }>(
  `select payment_link_id from fee_installments where id = $1`,
  [inst.id],
)) as [{ payment_link_id: string }]
const paid = JSON.stringify({
  event: 'payment_link.paid',
  payload: {
    payment_link: { entity: { id: linkId, reference_id: inst.id, amount_paid: 450000 } },
    payment: {
      entity: { id: 'pay_e2e', amount: 450000, created_at: Math.floor(Date.now() / 1000) },
    },
  },
})
const hook = await fetch(`${env.API_URL}/webhooks/razorpay/org/${orgId}`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-razorpay-signature': createHmac('sha256', 'e2e-webhook-secret').update(paid).digest('hex'),
  },
  body: paid,
})
check(hook.status === 200, 'Razorpay webhook accepted (signed with the org secret)')
const [fee] = await q<{ status: string; receipt_no: string }>(
  `select status, receipt_no from fee_installments where id = $1`,
  [inst.id],
)
check(
  fee?.status === 'paid' && /^R-\d{4}$/.test(fee.receipt_no),
  `installment paid, receipt ${fee?.receipt_no}`,
)
const receipt = await waitFor(async () => {
  const m = await lastOut()
  return m.body?.includes('mil gaye') ? m : null
}, 'the receipt')
check(receipt.body?.includes(fee.receipt_no), `receipt sent: "${receipt.body}"`)

// ---- 5. Home ----
const home = await staff<{
  enquiries: number
  demosBooked: number
  admissions: number
  feesCollectedPaise: number
}>('GET', '/analytics/summary?range=today')
check(
  home.enquiries >= 1 &&
    home.demosBooked >= 1 &&
    home.admissions >= 1 &&
    home.feesCollectedPaise >= 450000,
  `Home shows it: ${home.enquiries} enquiries, ${home.demosBooked} demos, ${home.admissions} admissions, ₹${home.feesCollectedPaise / 100} received`,
)

await close()
console.log('E2E coaching journey passed.')
