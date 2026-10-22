/**
 * What we can send, and Meta's limits on it, enforced before the request so a
 * mistake fails with a message a person can fix instead of a Graph error code.
 */

export type OutboundContent =
  | { kind: 'text'; body: string; previewUrl?: boolean }
  | {
      kind: 'buttons'
      body: string
      buttons: { id: string; title: string }[]
      header?: string
      footer?: string
    }
  | {
      kind: 'list'
      body: string
      buttonLabel: string
      sections: { title?: string; rows: { id: string; title: string; description?: string }[] }[]
      header?: string
      footer?: string
    }
  | {
      kind: 'template'
      name: string
      language: string
      components?: Record<string, unknown>[]
      /** The text as the person reads it, for our inbox. Never sent to Meta. */
      preview?: string
    }
  | { kind: 'image'; mediaId?: string; link?: string; storageKey?: string; caption?: string }
  | {
      kind: 'document'
      mediaId?: string
      link?: string
      /** Our own file (a brochure): the outbound worker uploads it and sets mediaId. */
      storageKey?: string
      mimeType?: string
      filename?: string
      caption?: string
    }
  | { kind: 'location'; latitude: number; longitude: number; name?: string; address?: string }

export const LIMITS = {
  textBody: 4096,
  interactiveBody: 1024,
  header: 60,
  footer: 60,
  buttons: 3,
  buttonTitle: 20,
  listButtonLabel: 20,
  listRows: 10,
  rowTitle: 24,
  rowDescription: 72,
  sectionTitle: 24,
  caption: 1024,
  id: 256,
} as const

export class ContentLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ContentLimitError'
  }
}

function max(label: string, value: string | undefined, limit: number) {
  if (value !== undefined && [...value].length > limit) {
    throw new ContentLimitError(
      `${label} is ${[...value].length} characters; WhatsApp allows ${limit}: "${value.slice(0, 40)}…"`,
    )
  }
}

function required(label: string, value: string | undefined) {
  if (!value?.trim()) throw new ContentLimitError(`${label} can't be empty`)
}

function media(c: { mediaId?: string; link?: string; storageKey?: string }) {
  const given = [c.mediaId, c.link].filter(Boolean).length
  // A storageKey alone is fine before upload; Meta only ever sees the mediaId it becomes.
  if (given === 0 && c.storageKey) return { id: `pending-upload:${c.storageKey}` }
  if (given !== 1) throw new ContentLimitError('Give exactly one of mediaId or link')
  return c.mediaId ? { id: c.mediaId } : { link: c.link }
}

/** Builds the JSON for `POST /{phone-number-id}/messages`. Throws ContentLimitError. */
export function buildMessagePayload(to: string, content: OutboundContent, replyTo?: string) {
  const base = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    ...(replyTo ? { context: { message_id: replyTo } } : {}),
  }

  switch (content.kind) {
    case 'text':
      required('Message', content.body)
      max('Message', content.body, LIMITS.textBody)
      return {
        ...base,
        type: 'text',
        text: { body: content.body, preview_url: content.previewUrl ?? false },
      }

    case 'buttons': {
      required('Message', content.body)
      max('Message', content.body, LIMITS.interactiveBody)
      max('Header', content.header, LIMITS.header)
      max('Footer', content.footer, LIMITS.footer)
      if (content.buttons.length < 1 || content.buttons.length > LIMITS.buttons) {
        throw new ContentLimitError(
          `Use 1 to ${LIMITS.buttons} buttons (got ${content.buttons.length})`,
        )
      }
      for (const b of content.buttons) {
        required('Button title', b.title)
        max('Button title', b.title, LIMITS.buttonTitle)
        max('Button id', b.id, LIMITS.id)
      }
      return {
        ...base,
        type: 'interactive',
        interactive: {
          type: 'button',
          ...(content.header ? { header: { type: 'text', text: content.header } } : {}),
          body: { text: content.body },
          ...(content.footer ? { footer: { text: content.footer } } : {}),
          action: {
            buttons: content.buttons.map((b) => ({
              type: 'reply',
              reply: { id: b.id, title: b.title },
            })),
          },
        },
      }
    }

    case 'list': {
      required('Message', content.body)
      max('Message', content.body, LIMITS.interactiveBody)
      max('Header', content.header, LIMITS.header)
      max('Footer', content.footer, LIMITS.footer)
      required('List button label', content.buttonLabel)
      max('List button label', content.buttonLabel, LIMITS.listButtonLabel)
      const rows = content.sections.flatMap((s) => s.rows)
      if (rows.length < 1 || rows.length > LIMITS.listRows) {
        throw new ContentLimitError(`Use 1 to ${LIMITS.listRows} list rows (got ${rows.length})`)
      }
      for (const s of content.sections) max('Section title', s.title, LIMITS.sectionTitle)
      for (const r of rows) {
        required('Row title', r.title)
        max('Row title', r.title, LIMITS.rowTitle)
        max('Row description', r.description, LIMITS.rowDescription)
        max('Row id', r.id, LIMITS.id)
      }
      return {
        ...base,
        type: 'interactive',
        interactive: {
          type: 'list',
          ...(content.header ? { header: { type: 'text', text: content.header } } : {}),
          body: { text: content.body },
          ...(content.footer ? { footer: { text: content.footer } } : {}),
          action: { button: content.buttonLabel, sections: content.sections },
        },
      }
    }

    case 'template':
      required('Template name', content.name)
      return {
        ...base,
        type: 'template',
        template: {
          name: content.name,
          language: { code: content.language },
          ...(content.components ? { components: content.components } : {}),
        },
      }

    case 'image':
      max('Caption', content.caption, LIMITS.caption)
      return { ...base, type: 'image', image: { ...media(content), caption: content.caption } }

    case 'document':
      max('Caption', content.caption, LIMITS.caption)
      return {
        ...base,
        type: 'document',
        document: { ...media(content), filename: content.filename, caption: content.caption },
      }

    case 'location':
      return {
        ...base,
        type: 'location',
        location: {
          latitude: content.latitude,
          longitude: content.longitude,
          name: content.name,
          address: content.address,
        },
      }
  }
}

/** Text stored in `messages.body` for an outbound message, for the inbox and search. */
export function bodyOf(content: OutboundContent): string | null {
  switch (content.kind) {
    case 'text':
    case 'buttons':
    case 'list':
      return content.body
    case 'image':
    case 'document':
      return content.caption ?? null
    case 'location':
      return content.name ?? content.address ?? null
    case 'template':
      return content.preview ?? null
  }
}
