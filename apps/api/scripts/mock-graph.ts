/**
 * A stand-in for Meta's Graph API, for running the whole loop on a laptop
 * without a Meta app:
 *
 *   META_GRAPH_BASE_URL=http://localhost:4010   (in .env)
 *   pnpm whatsapp:mock
 *
 * It accepts sends and read receipts like the real API, prints them, and then
 * does what Meta does next: posts signed `sent`, `delivered` and `read`
 * statuses back to our webhook. It also answers media uploads, "test
 * connection", templates (created PENDING, approved a second later by
 * webhook, as Meta's review would), and Razorpay's payment links
 * (RAZORPAY_BASE_URL pointed here), so fees and campaigns can be tried end
 * to end. Template messages are reported billable in their category, like
 * Meta's pricing; a number ending in 99 fails with Meta's marketing-limit
 * error. Never used in production.
 */
import { createServer } from 'node:http'
import { loadEnv } from '@haazir/shared/env'
import { signBody } from '@haazir/whatsapp'

const env = loadEnv()
const PORT = 4010
let counter = 0

interface MockTemplate {
  id: string
  name: string
  language: string
  category: string
  status: string
  components: unknown[]
  createdAt: number
}
const templateStore = new Map<string, MockTemplate>()
const categoryOf = (name: string) =>
  [...templateStore.values()].find((t) => t.name === name)?.category.toLowerCase() ?? 'utility'

async function postWebhook(body: string) {
  return fetch(`${env.API_URL}/webhooks/whatsapp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': signBody(body, env.META_APP_SECRET ?? ''),
    },
    body,
  })
}

/** Meta's review, a second after the submission: approved. */
async function approve(wabaId: string, t: MockTemplate) {
  t.status = 'APPROVED'
  const res = await postWebhook(
    JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: wabaId,
          changes: [
            {
              field: 'message_template_status_update',
              value: {
                event: 'APPROVED',
                message_template_id: t.id,
                message_template_name: t.name,
                message_template_language: t.language,
                reason: 'NONE',
              },
            },
          ],
        },
      ],
    }),
  )
  console.log(`  ← template ${t.name} (${t.language}) APPROVED (webhook answered ${res.status})`)
}

async function postStatus(
  phoneNumberId: string,
  waMessageId: string,
  to: string,
  status: string,
  pricing: { billable: boolean; category: string },
  errors?: { code: number; title: string }[],
) {
  const body = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: env.WHATSAPP_WABA_ID ?? 'mock-waba',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '910000000000', phone_number_id: phoneNumberId },
              statuses: [
                {
                  id: waMessageId,
                  status,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  recipient_id: to,
                  ...(status === 'failed'
                    ? { errors }
                    : { pricing: { ...pricing, pricing_model: 'PMP' } }),
                },
              ],
            },
          },
        ],
      },
    ],
  })
  const res = await postWebhook(body)
  console.log(`  ← status ${status.padEnd(9)} ${waMessageId} (webhook answered ${res.status})`)
}

createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => (raw += c))
  req.on('end', () => {
    res.setHeader('content-type', 'application/json')
    // Razorpay: payment links (create) and the authenticated read used as "test connection".
    if (req.url?.startsWith('/v1/payment_links')) {
      if (req.method === 'POST') {
        const body = JSON.parse(raw || '{}') as { amount: number; reference_id: string }
        const id = `plink_mock${Date.now()}${++counter}`
        console.log(`→ razorpay link ₹${body.amount / 100} for ${body.reference_id}: ${id}`)
        return res.end(
          JSON.stringify({ id, short_url: `https://rzp.io/i/${id}`, status: 'created' }),
        )
      }
      return res.end(JSON.stringify({ count: 0, items: [] }))
    }
    // Templates on the WhatsApp Business Account.
    const tpl = req.url?.match(/^\/(v\d+\.\d)\/([^/?]+)\/message_templates(\?.*)?$/)
    if (tpl) {
      const wabaId = tpl[2]!
      if (req.method === 'POST') {
        const body = JSON.parse(raw || '{}') as Omit<MockTemplate, 'id' | 'status' | 'createdAt'>
        const clash = [...templateStore.values()].find(
          (t) => t.name === body.name && t.language === body.language,
        )
        if (clash) {
          res.statusCode = 400
          return res.end(
            JSON.stringify({
              error: { code: 100, message: 'Content in this language already exists' },
            }),
          )
        }
        const t: MockTemplate = {
          ...body,
          id: String(900000000000 + ++counter),
          status: 'PENDING',
          createdAt: Date.now(),
        }
        templateStore.set(t.id, t)
        console.log(`→ template ${t.name} (${t.language}, ${t.category}) submitted`)
        setTimeout(() => void approve(wabaId, t), 1000)
        return res.end(JSON.stringify({ id: t.id, status: 'PENDING', category: t.category }))
      }
      if (req.method === 'DELETE') {
        const id = new URLSearchParams(tpl[3]?.slice(1)).get('hsm_id')
        if (id) templateStore.delete(id)
        return res.end(JSON.stringify({ success: true }))
      }
      return res.end(
        JSON.stringify({
          data: [...templateStore.values()].map((t) => ({
            id: t.id,
            name: t.name,
            language: t.language,
            status: t.status,
            category: t.category,
            components: t.components,
          })),
          paging: {},
        }),
      )
    }
    const edit = req.url?.match(/^\/(v\d+\.\d)\/(9\d{11})$/)
    if (req.method === 'POST' && edit) {
      const t = templateStore.get(edit[2]!)
      if (t) Object.assign(t, JSON.parse(raw || '{}'), { status: 'PENDING' })
      return res.end(JSON.stringify({ success: true }))
    }
    const media = req.url?.match(/^\/(v\d+\.\d)\/([^/]+)\/media$/)
    if (req.method === 'POST' && media) {
      console.log(`→ media upload (${raw.length} bytes)`)
      return res.end(JSON.stringify({ id: `media-mock-${++counter}` }))
    }
    const phone = req.url?.match(/^\/(v\d+\.\d)\/(\d+)\?fields=/)
    if (req.method === 'GET' && phone) {
      return res.end(
        JSON.stringify({
          id: phone[2],
          display_phone_number: '+91 90000 00001',
          verified_name: 'Mock Institute',
          quality_rating: 'GREEN',
        }),
      )
    }
    const match = req.url?.match(/^\/(v\d+\.\d)\/([^/]+)\/messages$/)
    if (req.method === 'POST' && match) {
      const [, version, phoneNumberId] = match
      const body = JSON.parse(raw || '{}') as {
        to: string
        type?: string
        status?: string
        message_id?: string
        typing_indicator?: unknown
        template?: { name?: string }
        text?: { body?: string }
        interactive?: { body?: { text?: string } }
      }
      if (body.status === 'read') {
        console.log(`→ read receipt ${body.message_id}${body.typing_indicator ? ' + typing' : ''}`)
        return res.end(JSON.stringify({ success: true }))
      }
      const waMessageId = `wamid.MOCK${Date.now()}${++counter}`
      const text =
        body.text?.body ??
        body.interactive?.body?.text ??
        (body.template ? `[template ${body.template.name}]` : `[${body.type}]`)
      console.log(`→ send (${version}) to ${body.to}: ${text}`)
      res.end(
        JSON.stringify({
          messaging_product: 'whatsapp',
          contacts: [{ input: body.to, wa_id: body.to }],
          messages: [{ id: waMessageId }],
        }),
      )
      // Meta's statuses arrive a moment after the send is accepted. Templates
      // are charged in their category; replies inside the window are not.
      const pricing = body.template?.name
        ? { billable: true, category: categoryOf(body.template.name) }
        : { billable: false, category: 'service' }
      const steps = body.to.endsWith('99') ? ['failed'] : ['sent', 'delivered', 'read']
      const errors = [
        { code: 131049, title: 'Message not delivered to maintain healthy ecosystem engagement' },
      ]
      steps.forEach((status, i) =>
        setTimeout(
          () => void postStatus(phoneNumberId!, waMessageId, body.to, status, pricing, errors),
          400 * (i + 1),
        ),
      )
      return
    }
    res.statusCode = 404
    res.end(
      JSON.stringify({
        error: { code: 100, message: `Mock has no route for ${req.method} ${req.url}` },
      }),
    )
  })
}).listen(PORT, () => console.log(`Mock Graph API on http://localhost:${PORT}`))
