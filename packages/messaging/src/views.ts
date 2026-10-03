import { and, eq, sql } from 'drizzle-orm'
import { contacts, conversations, messages, type AnyDatabase } from '@haazir/db'
import type { OrgEvents } from './queue'

/**
 * What dashboards see of conversations and messages: the same shape from the
 * API's responses and from live events, whichever process sends them. Media
 * ids and storage keys stay on the server.
 */
export const conversationSummary = {
  id: conversations.id,
  mode: conversations.mode,
  unreadCount: conversations.unreadCount,
  lastMessageAt: conversations.lastMessageAt,
  lastMessagePreview: conversations.lastMessagePreview,
  serviceWindowExpiresAt: conversations.serviceWindowExpiresAt,
  humanUntil: conversations.humanUntil,
  handoffReason: conversations.handoffReason,
  handoffSummary: conversations.handoffSummary,
  handoffAt: conversations.handoffAt,
  assignedUserId: conversations.assignedUserId,
  contact: {
    id: contacts.id,
    name: contacts.name,
    profileName: contacts.profileName,
    waId: contacts.waId,
    language: contacts.language,
    optInStatus: contacts.optInStatus,
  },
}

export const messageView = {
  id: messages.id,
  conversationId: messages.conversationId,
  direction: messages.direction,
  type: messages.type,
  body: messages.body,
  transcript: messages.transcript,
  status: messages.status,
  errorCode: messages.errorCode,
  errorTitle: messages.errorTitle,
  sentBy: messages.sentBy,
  sentByUserId: messages.sentByUserId,
  mediaMime: messages.mediaMime,
  hasMedia: sql<boolean>`${messages.mediaKey} is not null`,
  interactive: messages.interactive,
  createdAt: messages.createdAt,
}

export async function loadConversationSummary(db: AnyDatabase, orgId: string, id: string) {
  const [row] = await db
    .select(conversationSummary)
    .from(conversations)
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
    .where(and(eq(conversations.id, id), eq(conversations.orgId, orgId)))
  return row ?? null
}

export async function loadMessageView(db: AnyDatabase, orgId: string, id: string) {
  const [row] = await db
    .select(messageView)
    .from(messages)
    .where(and(eq(messages.id, id), eq(messages.orgId, orgId)))
  return row ?? null
}

/** Pushes a message (new or changed) and its conversation to the org's open dashboards. */
export async function announceMessage(
  db: AnyDatabase,
  events: OrgEvents,
  orgId: string,
  messageId: string,
  event: 'message:new' | 'message:updated' = 'message:updated',
) {
  const view = await loadMessageView(db, orgId, messageId)
  if (!view) return
  events.emit(orgId, event, view)
  const conversation = await loadConversationSummary(db, orgId, view.conversationId)
  if (conversation) events.emit(orgId, 'conversation:updated', conversation)
}

export async function announceConversation(
  db: AnyDatabase,
  events: OrgEvents,
  orgId: string,
  id: string,
) {
  const conversation = await loadConversationSummary(db, orgId, id)
  if (conversation) events.emit(orgId, 'conversation:updated', conversation)
}
