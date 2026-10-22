import { and, asc, eq } from 'drizzle-orm'
import {
  contacts,
  conversations,
  organizations,
  templates,
  whatsappAccounts,
  type AnyDatabase,
} from '@haazir/db'
import {
  AppError,
  defaultTemplate,
  fillTemplate,
  partsOf,
  templateKey,
  templateParam,
  type CopyLanguage,
  type TemplatePurpose,
} from '@haazir/shared'
import type { OutboundContent } from '@haazir/whatsapp'
import { queueOutbound, type OutboundMessage } from './outbound'
import type { JobQueue, OutboundJob } from './queue'

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

/**
 * Non-urgent messages wait out the night (spec §13: quiet hours 9 PM to 8 AM
 * IST). Returns when sending may start, or null if it may go now.
 */
export function quietUntil(now: Date): Date | null {
  const ist = new Date(now.getTime() + IST_OFFSET_MS)
  const hour = ist.getUTCHours()
  if (hour >= 8 && hour < 21) return null
  const eight = new Date(ist)
  eight.setUTCHours(8, 0, 0, 0)
  if (hour >= 21) eight.setUTCDate(eight.getUTCDate() + 1)
  return new Date(eight.getTime() - IST_OFFSET_MS)
}

export type AutomationResult =
  | { sent: true; message: OutboundMessage }
  | {
      sent: false
      reason: 'opted_out' | 'no_number' | 'no_template' | 'quiet_hours' | 'window_closed'
      retryAt?: Date
    }

/**
 * Sends one of the automation messages (spec §13) to a contact: free-form
 * text inside the 24-hour window, the approved template outside it. Never
 * sends to someone who opted out, and holds non-urgent ones through the night.
 * Returns why it didn't send instead of throwing, so a sweep can carry on.
 *
 * `buttonRef` is appended to the template's quick-reply ids
 * ("demo_yes:<booking id>") so the answer comes back to the right booking.
 */
export async function sendAutomation(
  deps: { db: AnyDatabase; outboundQueue: JobQueue<OutboundJob> },
  input: {
    orgId: string
    contactId: string
    purpose: TemplatePurpose
    values: string[]
    buttonRef?: string
    urgent?: boolean
    sentBy?: 'reminder' | 'system'
    now: Date
  },
): Promise<AutomationResult> {
  const { db } = deps
  const [contact] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, input.contactId), eq(contacts.orgId, input.orgId)))
  if (!contact || contact.optInStatus === 'opted_out') return { sent: false, reason: 'opted_out' }

  if (!input.urgent) {
    const retryAt = quietUntil(input.now)
    if (retryAt) return { sent: false, reason: 'quiet_hours', retryAt }
  }

  const conversation = await ensureConversation(db, input.orgId, contact.id)
  if (!conversation) return { sent: false, reason: 'no_number' }

  const [org] = await db.select().from(organizations).where(eq(organizations.id, input.orgId))
  const lang = copyLanguage(contact.language, org?.defaultLanguage)
  const def = defaultTemplate(input.purpose)
  const windowOpen =
    !!conversation.serviceWindowExpiresAt && conversation.serviceWindowExpiresAt > input.now

  let content: OutboundContent | null
  if (windowOpen && def) {
    const body = fillTemplate(def.body[lang], input.values)
    content = def.buttons?.length
      ? {
          kind: 'buttons',
          body,
          buttons: def.buttons.map((b) => ({
            id: input.buttonRef ? `${b.id}:${input.buttonRef}` : b.id,
            title: b.title[lang],
          })),
        }
      : { kind: 'text', body, previewUrl: true }
  } else {
    content = await templateContent(
      db,
      input.orgId,
      input.purpose,
      lang,
      input.values,
      input.buttonRef,
    )
    if (!content) return { sent: false, reason: 'no_template' }
  }

  try {
    const message = await queueOutbound(deps, {
      orgId: input.orgId,
      conversationId: conversation.id,
      content,
      sentBy: input.sentBy ?? 'reminder',
      now: input.now,
    })
    return { sent: true, message }
  } catch (err) {
    if (err instanceof AppError && err.code === 'OPTED_OUT')
      return { sent: false, reason: 'opted_out' }
    if (err instanceof AppError && err.code === 'WINDOW_CLOSED')
      return { sent: false, reason: 'window_closed' }
    throw err
  }
}

/** The contact's language for our copy: theirs if we know it, else the institute's default. */
export function copyLanguage(
  contactLanguage: string | null,
  orgDefault?: string | null,
): CopyLanguage {
  for (const l of [contactLanguage, orgDefault])
    if (l === 'hi' || l === 'en' || l === 'hinglish') return l
  return 'hinglish'
}

/**
 * An approved template for the purpose, preferring the contact's language and
 * falling back to any approved variant: a reminder in English beats none.
 */
async function templateContent(
  db: AnyDatabase,
  orgId: string,
  purpose: TemplatePurpose,
  lang: CopyLanguage,
  values: string[],
  buttonRef?: string,
): Promise<OutboundContent | null> {
  const approved = await db
    .select()
    .from(templates)
    .where(
      and(
        eq(templates.orgId, orgId),
        eq(templates.purpose, purpose),
        eq(templates.status, 'approved'),
      ),
    )
  if (!approved.length) return null
  const preferred = templateKey(purpose, lang)
  const chosen =
    approved.find((t) => t.name === preferred.name && t.language === preferred.language) ??
    approved[0]!
  const buttons = (
    chosen.components.find((c) => c.type === 'BUTTONS') as { buttons?: unknown[] } | undefined
  )?.buttons
  const ids = defaultTemplate(purpose)?.buttons?.map((b) => b.id) ?? []
  return {
    kind: 'template',
    name: chosen.name,
    language: chosen.language,
    preview: fillTemplate(partsOf(chosen.components).body, values),
    components: [
      ...(values.length
        ? [
            {
              type: 'body',
              parameters: values.map((text) => ({ type: 'text', text: templateParam(text) })),
            },
          ]
        : []),
      // Quick-reply payloads carry our ids back, e.g. "demo_yes:<booking id>".
      ...(buttons ?? []).map((_, index) => ({
        type: 'button',
        sub_type: 'quick_reply',
        index: String(index),
        parameters: [
          {
            type: 'payload',
            payload: buttonRef ? `${ids[index] ?? 'btn'}:${buttonRef}` : (ids[index] ?? 'btn'),
          },
        ],
      })),
    ],
  }
}

/**
 * The contact's conversation, created if this is the first message we send
 * them (a student added at the desk). Null when the org has no number yet.
 */
export async function ensureConversation(db: AnyDatabase, orgId: string, contactId: string) {
  const [existing] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.orgId, orgId), eq(conversations.contactId, contactId)))
  if (existing?.whatsappAccountId) return existing

  const [account] = await db
    .select({ id: whatsappAccounts.id })
    .from(whatsappAccounts)
    .where(and(eq(whatsappAccounts.orgId, orgId), eq(whatsappAccounts.status, 'connected')))
    .orderBy(asc(whatsappAccounts.createdAt))
    .limit(1)
  if (!account) return null
  if (existing) {
    const [updated] = await db
      .update(conversations)
      .set({ whatsappAccountId: account.id })
      .where(eq(conversations.id, existing.id))
      .returning()
    return updated ?? null
  }
  await db
    .insert(conversations)
    .values({ orgId, contactId, whatsappAccountId: account.id })
    .onConflictDoNothing()
  const [created] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.orgId, orgId), eq(conversations.contactId, contactId)))
  return created ?? null
}
