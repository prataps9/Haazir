import { z } from 'zod'

/**
 * Turns a Cloud API webhook body into flat lists of inbound messages and
 * delivery statuses (spec §10). Shapes follow Graph API v26.0.
 *
 * Deliberately forgiving: Meta adds fields and message types without notice,
 * so unknown fields are ignored, unknown types become `unsupported`, and a
 * malformed entry is reported in `problems` instead of failing the batch.
 */

export type InboundType =
  | 'text'
  | 'image'
  | 'audio'
  | 'video'
  | 'document'
  | 'sticker'
  | 'location'
  | 'contacts'
  | 'interactive'
  | 'button'
  | 'reaction'
  | 'unsupported'

export interface InboundMedia {
  id: string
  mimeType?: string
  filename?: string
  /** Audio recorded in WhatsApp as a voice note (as opposed to a sent file). */
  voice?: boolean
}

export interface InboundMessage {
  phoneNumberId: string
  waMessageId: string
  /** Meta's identifier for the sender: phone digits, or a BSUID for username users. */
  from: string
  /** Business-scoped user ID, present on all webhooks since March 2026. */
  bsuid?: string
  profileName?: string
  timestamp: Date
  type: InboundType
  /** What a person would read: the text, a caption, a button title, an emoji… */
  text?: string
  media?: InboundMedia
  location?: { latitude: number; longitude: number; name?: string; address?: string }
  /** A tap on a reply button or list row (or a template quick-reply button). */
  interactive?: { kind: 'button_reply' | 'list_reply' | 'button'; id: string; title: string }
  reaction?: { messageId: string; emoji?: string }
  /** The message this one quotes. */
  replyTo?: string
}

export type DeliveryStatus = 'sent' | 'delivered' | 'read' | 'failed'

export interface StatusUpdate {
  phoneNumberId: string
  waMessageId: string
  status: DeliveryStatus
  timestamp: Date
  recipient: string
  pricingCategory?: string
  /** Meta's `pricing.billable`: whether this message is charged. */
  billable?: boolean
  errors: { code: number; title: string; details?: string }[]
}

/**
 * Meta reviewed a template (`message_template_status_update`) or moved it to
 * another category (`template_category_update`). Keyed by the WABA (entry id).
 */
export interface TemplateUpdate {
  wabaId: string
  metaTemplateId: string
  name?: string
  language?: string
  /** APPROVED, REJECTED, PENDING, PAUSED, DISABLED, IN_APPEAL… (upper case, as Meta sends). */
  event?: string
  reason?: string
  newCategory?: string
}

export interface ParsedWebhook {
  messages: InboundMessage[]
  statuses: StatusUpdate[]
  templates: TemplateUpdate[]
  /** Changes we don't handle (account updates, quality changes…). */
  ignoredFields: string[]
  problems: string[]
}

const unixSeconds = z
  .union([z.string(), z.number()])
  .transform((v) => new Date(Number(v) * 1000))
  .refine((d) => !Number.isNaN(d.getTime()), 'invalid timestamp')

const media = z.object({
  id: z.string(),
  mime_type: z.string().optional(),
  caption: z.string().optional(),
  filename: z.string().optional(),
  voice: z.boolean().optional(),
})

const messageSchema = z.object({
  id: z.string(),
  from: z.string(),
  user_id: z.string().optional(),
  timestamp: unixSeconds,
  type: z.string(),
  context: z.object({ id: z.string().optional() }).optional(),
  text: z.object({ body: z.string() }).optional(),
  image: media.optional(),
  audio: media.optional(),
  video: media.optional(),
  document: media.optional(),
  sticker: media.optional(),
  location: z
    .object({
      latitude: z.number(),
      longitude: z.number(),
      name: z.string().optional(),
      address: z.string().optional(),
    })
    .optional(),
  interactive: z
    .object({
      type: z.string(),
      button_reply: z.object({ id: z.string(), title: z.string() }).optional(),
      list_reply: z.object({ id: z.string(), title: z.string() }).optional(),
    })
    .optional(),
  button: z.object({ payload: z.string().optional(), text: z.string() }).optional(),
  reaction: z.object({ message_id: z.string(), emoji: z.string().optional() }).optional(),
})

const statusSchema = z.object({
  id: z.string(),
  status: z.enum(['sent', 'delivered', 'read', 'failed']),
  timestamp: unixSeconds,
  recipient_id: z.string(),
  pricing: z
    .object({ category: z.string().optional(), billable: z.boolean().optional() })
    .optional(),
  errors: z
    .array(
      z.object({
        code: z.number(),
        title: z.string(),
        error_data: z.object({ details: z.string().optional() }).optional(),
      }),
    )
    .optional(),
})

const valueSchema = z.object({
  metadata: z.object({ phone_number_id: z.string() }),
  contacts: z
    .array(
      z.object({
        wa_id: z.string().optional(),
        user_id: z.string().optional(),
        profile: z.object({ name: z.string().optional() }).optional(),
      }),
    )
    .optional(),
  messages: z.array(z.unknown()).optional(),
  statuses: z.array(z.unknown()).optional(),
})

const templateStatusSchema = z.object({
  event: z.string().optional(),
  message_template_id: z.union([z.string(), z.number()]).transform(String),
  message_template_name: z.string().optional(),
  message_template_language: z.string().optional(),
  reason: z.string().nullable().optional(),
  other_info: z.object({ description: z.string().optional() }).optional(),
})

const templateCategorySchema = z.object({
  message_template_id: z.union([z.string(), z.number()]).transform(String),
  message_template_name: z.string().optional(),
  message_template_language: z.string().optional(),
  new_category: z.string().optional(),
  correct_category: z.string().optional(),
})

const envelopeSchema = z.object({
  object: z.literal('whatsapp_business_account'),
  entry: z.array(
    z.object({
      id: z.string().optional(),
      changes: z.array(z.object({ field: z.string(), value: z.unknown() })),
    }),
  ),
})

const MEDIA_TYPES = ['image', 'audio', 'video', 'document', 'sticker'] as const

export function parseWebhook(body: unknown): ParsedWebhook {
  const result: ParsedWebhook = {
    messages: [],
    statuses: [],
    templates: [],
    ignoredFields: [],
    problems: [],
  }

  const envelope = envelopeSchema.safeParse(body)
  if (!envelope.success) {
    result.problems.push('Not a WhatsApp Business Account webhook')
    return result
  }

  for (const entry of envelope.data.entry) {
    for (const change of entry.changes) {
      if (change.field === 'message_template_status_update') {
        const t = templateStatusSchema.safeParse(change.value)
        if (!t.success || !entry.id) {
          result.problems.push('Malformed template status update')
          continue
        }
        const reason = t.data.reason && t.data.reason !== 'NONE' ? t.data.reason : undefined
        result.templates.push({
          wabaId: entry.id,
          metaTemplateId: t.data.message_template_id,
          name: t.data.message_template_name,
          language: t.data.message_template_language,
          event: t.data.event?.toUpperCase(),
          reason: [reason, t.data.other_info?.description].filter(Boolean).join(': ') || undefined,
        })
        continue
      }
      if (change.field === 'template_category_update') {
        const t = templateCategorySchema.safeParse(change.value)
        if (!t.success || !entry.id) {
          result.problems.push('Malformed template category update')
          continue
        }
        result.templates.push({
          wabaId: entry.id,
          metaTemplateId: t.data.message_template_id,
          name: t.data.message_template_name,
          language: t.data.message_template_language,
          newCategory: (t.data.correct_category ?? t.data.new_category)?.toLowerCase(),
        })
        continue
      }
      if (change.field !== 'messages') {
        result.ignoredFields.push(change.field)
        continue
      }

      const value = valueSchema.safeParse(change.value)
      if (!value.success) {
        result.problems.push(`Malformed messages change: ${value.error.issues[0]?.message}`)
        continue
      }
      const phoneNumberId = value.data.metadata.phone_number_id
      const contacts = value.data.contacts ?? []

      for (const raw of value.data.messages ?? []) {
        const parsed = messageSchema.safeParse(raw)
        if (!parsed.success) {
          result.problems.push(`Malformed message: ${parsed.error.issues[0]?.message}`)
          continue
        }
        const m = parsed.data
        const contact =
          contacts.find((c) => c.wa_id === m.from) ??
          contacts.find((c) => m.user_id && c.user_id === m.user_id) ??
          (contacts.length === 1 ? contacts[0] : undefined)
        result.messages.push(toInbound(m, phoneNumberId, contact))
      }

      for (const raw of value.data.statuses ?? []) {
        const parsed = statusSchema.safeParse(raw)
        if (!parsed.success) {
          result.problems.push(`Malformed status: ${parsed.error.issues[0]?.message}`)
          continue
        }
        const s = parsed.data
        result.statuses.push({
          phoneNumberId,
          waMessageId: s.id,
          status: s.status,
          timestamp: s.timestamp,
          recipient: s.recipient_id,
          pricingCategory: s.pricing?.category,
          billable: s.pricing?.billable,
          errors: (s.errors ?? []).map((e) => ({
            code: e.code,
            title: e.title,
            details: e.error_data?.details,
          })),
        })
      }
    }
  }

  return result
}

function toInbound(
  m: z.infer<typeof messageSchema>,
  phoneNumberId: string,
  contact: { user_id?: string; profile?: { name?: string } } | undefined,
): InboundMessage {
  const base = {
    phoneNumberId,
    waMessageId: m.id,
    from: m.from,
    bsuid: m.user_id ?? contact?.user_id,
    profileName: contact?.profile?.name,
    timestamp: m.timestamp,
    replyTo: m.context?.id,
  }

  if (m.type === 'text' && m.text) return { ...base, type: 'text', text: m.text.body }

  for (const kind of MEDIA_TYPES) {
    const item = m[kind]
    if (m.type === kind && item) {
      return {
        ...base,
        type: kind,
        text: item.caption,
        media: {
          id: item.id,
          mimeType: item.mime_type,
          filename: item.filename,
          voice: item.voice,
        },
      }
    }
  }

  if (m.type === 'location' && m.location) {
    return { ...base, type: 'location', text: m.location.name, location: m.location }
  }

  if (m.type === 'interactive' && m.interactive) {
    const reply = m.interactive.button_reply ?? m.interactive.list_reply
    if (reply) {
      const kind = m.interactive.button_reply ? 'button_reply' : 'list_reply'
      return { ...base, type: 'interactive', text: reply.title, interactive: { kind, ...reply } }
    }
  }

  if (m.type === 'button' && m.button) {
    return {
      ...base,
      type: 'button',
      text: m.button.text,
      interactive: { kind: 'button', id: m.button.payload ?? m.button.text, title: m.button.text },
    }
  }

  if (m.type === 'reaction' && m.reaction) {
    return {
      ...base,
      type: 'reaction',
      text: m.reaction.emoji,
      reaction: { messageId: m.reaction.message_id, emoji: m.reaction.emoji },
    }
  }

  if (m.type === 'contacts') return { ...base, type: 'contacts' }

  return { ...base, type: 'unsupported' }
}

/**
 * One line for the inbox list: what the message says, or what it is. Plain
 * words, no emoji; the dashboard adds the icon for the type.
 */
export function previewOf(message: Pick<InboundMessage, 'type' | 'text'>): string {
  if (message.text) return message.text.slice(0, 120)
  const labels: Record<InboundType, string> = {
    text: '',
    image: 'Photo',
    audio: 'Voice note',
    video: 'Video',
    document: 'Document',
    sticker: 'Sticker',
    location: 'Location',
    contacts: 'Contact card',
    interactive: 'Reply',
    button: 'Reply',
    reaction: 'Reaction',
    unsupported: 'Unsupported message',
  }
  return labels[message.type]
}
