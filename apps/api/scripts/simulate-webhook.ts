/**
 * Sends a signed inbound WhatsApp message to the running API, exactly as Meta
 * would. Pair with `pnpm whatsapp:mock` to test the full loop locally:
 *
 *   pnpm whatsapp:simulate "RS-CIT ki fees kitni hai?"
 *   pnpm whatsapp:simulate --from 919812345678 --name "Anil Kumar" "Hello"
 *   pnpm whatsapp:simulate --repeat 2 "Same delivery twice"   # duplicate test
 *   pnpm whatsapp:simulate --tap menu_demo "Free demo"            # a reply button
 *   pnpm whatsapp:simulate --tap demo_day:2026-10-23 --list "Kal"  # a list row
 */
import { parseArgs } from 'node:util'
import { loadEnv } from '@haazir/shared/env'
import { signBody } from '@haazir/whatsapp'

const env = loadEnv()
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    from: { type: 'string', default: '919812345678' },
    name: { type: 'string', default: 'Anil Kumar' },
    repeat: { type: 'string', default: '1' },
    // The id of a tapped reply button or list row; the text is its title.
    tap: { type: 'string' },
    list: { type: 'boolean', default: false },
  },
})

if (!env.META_APP_SECRET || !env.WHATSAPP_PHONE_NUMBER_ID) {
  console.error('Set META_APP_SECRET and WHATSAPP_PHONE_NUMBER_ID in .env first.')
  process.exit(1)
}

const text = positionals.join(' ') || 'RS-CIT ki fees kitni hai?'
const id = `wamid.SIM${Date.now()}`
const body = JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: env.WHATSAPP_WABA_ID ?? 'sim-waba',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: {
              display_phone_number: '910000000000',
              phone_number_id: env.WHATSAPP_PHONE_NUMBER_ID,
            },
            contacts: [{ profile: { name: values.name }, wa_id: values.from }],
            messages: [
              {
                from: values.from,
                id,
                timestamp: String(Math.floor(Date.now() / 1000)),
                ...(values.tap
                  ? {
                      type: 'interactive',
                      interactive: values.list
                        ? { type: 'list_reply', list_reply: { id: values.tap, title: text } }
                        : { type: 'button_reply', button_reply: { id: values.tap, title: text } },
                    }
                  : { type: 'text', text: { body: text } }),
              },
            ],
          },
        },
      ],
    },
  ],
})

for (let i = 0; i < Number(values.repeat); i++) {
  const res = await fetch(`${env.API_URL}/webhooks/whatsapp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': signBody(body, env.META_APP_SECRET),
    },
    body,
  })
  console.log(`Delivered ${id} from ${values.from}: "${text}" → ${res.status}`)
}
