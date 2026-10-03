/**
 * The slice of a BullMQ Queue the domain code uses. A real `Queue` satisfies
 * it; tests pass an in-memory recorder instead of needing Redis.
 */
export interface JobQueue<T> {
  add(name: string, data: T, opts?: { jobId?: string; delay?: number }): Promise<unknown>
}

export interface OutboundJob {
  messageId: string
}

export interface AiReplyJob {
  orgId: string
  conversationId: string
  messageId: string
}

export interface MediaJob {
  orgId: string
  messageId: string
  mediaId: string
  mimeType?: string
}

export interface InboundJob {
  payload: unknown
  receivedAt: string
}

export interface IngestJob {
  orgId: string
  sourceId: string
}

/**
 * Live updates for an org's dashboards (Socket.IO room per org). The API
 * emits directly; the worker emits through Redis. Tests record them.
 */
export interface OrgEvents {
  emit(orgId: string, event: OrgEventName, data: unknown): void
}

/**
 * message:new / message:updated carry a MessageView, conversation:updated a
 * ConversationSummary (views.ts); the dashboard upserts them by id.
 */
export type OrgEventName =
  'message:new' | 'message:updated' | 'conversation:updated' | 'handoff' | 'knowledge:updated'

export const noEvents: OrgEvents = { emit: () => {} }
