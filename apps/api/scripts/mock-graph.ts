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
 * connection", and Razorpay's payment links (RAZORPAY_BASE_URL pointed
 * here), so fees can be tried end to end. Never used in production.
 */
import { createServer } from 'node:http'
import { loadEnv } from '@haazir/shared/env'
import { signBody } from '@haazir/whatsapp'

const env = loadEnv()
const PORT = 4010
let counter = 0

async function postStatus(phoneNumberId: string, waMessageId: string, to: string, status: string) {
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
                  pricing: { billable: false, pricing_model: 'PMP', category: 'service' },
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
      'x-hub-signature-256': signBody(body, env.META_APP_SECRET ?? ''),
    },
    body,
  })
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
        text?: { body?: string }
        interactive?: { body?: { text?: string } }
      }
      if (body.status === 'read') {
        console.log(`→ read receipt ${body.message_id}${body.typing_indicator ? ' + typing' : ''}`)
        return res.end(JSON.stringify({ success: true }))
      }
      const waMessageId = `wamid.MOCK${Date.now()}${++counter}`
      const text = body.text?.body ?? body.interactive?.body?.text ?? `[${body.type}]`
      console.log(`→ send (${version}) to ${body.to}: ${text}`)
      res.end(
        JSON.stringify({
          messaging_product: 'whatsapp',
          contacts: [{ input: body.to, wa_id: body.to }],
          messages: [{ id: waMessageId }],
        }),
      )
      // Meta's statuses arrive a moment after the send is accepted.
      const steps = ['sent', 'delivered', 'read']
      steps.forEach((status, i) =>
        setTimeout(
          () => void postStatus(phoneNumberId!, waMessageId, body.to, status),
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
