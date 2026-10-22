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

/** Delayed and repeating automation work (spec §13). Job ids are deterministic, so scheduling twice schedules once. */
export type ReminderJob =
  | { kind: 'demo_reminder'; orgId: string; bookingId: string }
  | { kind: 'demo_followup'; orgId: string; bookingId: string }
  /** The daily fee run: statuses move, reminders go, links are made. No orgId = every org. */
  | { kind: 'fee_sweep'; orgId?: string }

/** One step of a campaign: start (snapshot the audience) or the next batch. */
export interface CampaignJob {
  orgId: string
  campaignId: string
}

/** The 8 PM summary: no orgId fans out to every org; with one, sends that org's. */
export interface SummaryJob {
  orgId?: string
  /** The IST day summarised (YYYY-MM-DD), so a retry sends the same day's numbers. */
  day?: string
}

/** Template status poll (spec §10, every 15 minutes). No orgId = every org with a number. */
export interface TemplateSyncJob {
  orgId?: string
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
  | 'message:new'
  | 'message:updated'
  | 'conversation:updated'
  | 'handoff'
  | 'knowledge:updated'
  /** A lead moved or changed (the bot booked a demo, staff dragged a card). */
  | 'lead:updated'
  | 'demo:updated'
  | 'fee:updated'
  /** Meta reviewed a template, or the poll found a change. */
  | 'template:updated'
  /** A campaign started, moved on a batch, or finished. */
  | 'campaign:updated'

export const noEvents: OrgEvents = { emit: () => {} }
