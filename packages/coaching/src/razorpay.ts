import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * The slice of Razorpay we use: payment links for fees (spec §16.7), against
 * the institute's own account. `fetch` is injected so tests never call Razorpay.
 */
export interface RazorpayCredentials {
  keyId: string
  keySecret: string
}

export class RazorpayError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'RazorpayError'
  }
}

export interface PaymentLink {
  id: string
  shortUrl: string
  status: string
}

export interface RazorpayClientOptions extends RazorpayCredentials {
  baseUrl?: string
  fetch?: typeof fetch
}

export function createRazorpay(options: RazorpayClientOptions) {
  const baseUrl = options.baseUrl ?? 'https://api.razorpay.com'
  const doFetch = options.fetch ?? fetch
  const auth = `Basic ${Buffer.from(`${options.keyId}:${options.keySecret}`).toString('base64')}`

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await doFetch(`${baseUrl}${path}`, {
      ...init,
      headers: { authorization: auth, 'content-type': 'application/json', ...init.headers },
      signal: AbortSignal.timeout(15_000),
    })
    const body = (await res.json().catch(() => null)) as
      (T & { error?: { description?: string } }) | null
    if (!res.ok) {
      throw new RazorpayError(res.status, body?.error?.description ?? `Razorpay said ${res.status}`)
    }
    return body as T
  }

  return {
    /**
     * A one-off link for one installment. `referenceId` (our installment id)
     * is unique per link at Razorpay, so a retried call can't create two.
     */
    async createPaymentLink(input: {
      amountPaise: number
      description: string
      referenceId: string
      customer: { name: string; phone: string }
      expireBy?: Date
      notes?: Record<string, string>
    }): Promise<PaymentLink> {
      const res = await request<{ id: string; short_url: string; status: string }>(
        '/v1/payment_links',
        {
          method: 'POST',
          body: JSON.stringify({
            amount: input.amountPaise,
            currency: 'INR',
            accept_partial: false,
            description: input.description.slice(0, 2048),
            reference_id: input.referenceId.slice(0, 40),
            customer: { name: input.customer.name, contact: `+${input.customer.phone}` },
            // We send the link on WhatsApp ourselves; Razorpay's SMS would be a duplicate.
            notify: { sms: false, email: false },
            reminder_enable: false,
            ...(input.expireBy ? { expire_by: Math.floor(input.expireBy.getTime() / 1000) } : {}),
            notes: input.notes ?? {},
          }),
        },
      )
      return { id: res.id, shortUrl: res.short_url, status: res.status }
    },

    /** "Test connection": a cheap authenticated read that proves the keys work. */
    async check(): Promise<void> {
      await request('/v1/payment_links?count=1')
    },
  }
}

export type RazorpayClient = ReturnType<typeof createRazorpay>

/**
 * Razorpay signs webhooks with HMAC-SHA256 of the raw body using the webhook
 * secret, hex encoded, in `X-Razorpay-Signature`.
 */
export function verifyRazorpaySignature(
  rawBody: Buffer | string,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature) return false
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** The parts of a `payment_link.paid` webhook we act on. Null for any other event. */
export function parsePaymentLinkPaid(body: unknown): {
  paymentLinkId: string
  referenceId: string | null
  paymentId: string | null
  amountPaise: number
  paidAt: Date
} | null {
  const b = body as {
    event?: string
    created_at?: number
    payload?: {
      payment_link?: { entity?: { id?: string; reference_id?: string; amount_paid?: number } }
      payment?: { entity?: { id?: string; amount?: number; created_at?: number } }
    }
  }
  if (b?.event !== 'payment_link.paid') return null
  const link = b.payload?.payment_link?.entity
  const payment = b.payload?.payment?.entity
  if (!link?.id) return null
  const at = payment?.created_at ?? b.created_at
  return {
    paymentLinkId: link.id,
    referenceId: link.reference_id ?? null,
    paymentId: payment?.id ?? null,
    amountPaise: payment?.amount ?? link.amount_paid ?? 0,
    paidAt: at ? new Date(at * 1000) : new Date(),
  }
}
