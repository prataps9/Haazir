/** Shapes the API returns (apps/api, packages/messaging/src/views.ts). */

export type Role = 'owner' | 'admin' | 'agent'
export type Mode = 'bot' | 'human' | 'closed'
export type DeliveryStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed'

export interface Me {
  user: { id: string; name: string; email: string; uiLanguage: string; isSuperAdmin: boolean }
  orgs: { id: string; name: string; displayName: string; city: string | null; role: Role }[]
}

export interface ConversationSummary {
  id: string
  mode: Mode
  unreadCount: number
  lastMessageAt: string | null
  lastMessagePreview: string | null
  serviceWindowExpiresAt: string | null
  humanUntil: string | null
  handoffReason: string | null
  handoffSummary: string | null
  handoffAt: string | null
  assignedUserId: string | null
  contact: {
    id: string
    name: string | null
    profileName: string | null
    waId: string
    language: string | null
    optInStatus: 'opted_in' | 'opted_out' | 'unknown'
  }
}

export interface Message {
  id: string
  conversationId: string
  direction: 'in' | 'out'
  type: string
  body: string | null
  transcript: string | null
  status: DeliveryStatus | null
  errorCode: string | null
  errorTitle: string | null
  sentBy: 'bot' | 'user' | 'campaign' | 'reminder' | 'system' | null
  sentByUserId: string | null
  mediaMime: string | null
  hasMedia: boolean
  interactive: {
    content?: { kind: string; buttons?: { id: string; title: string }[] }
    kind?: string
    title?: string
  } | null
  createdAt: string
  /** Client-only: shown while the send request is in flight. */
  pending?: boolean
}

export interface Contact {
  id: string
  waId: string
  name: string | null
  profileName: string | null
  language: string | null
  tags: string[]
  notes: string | null
  optInStatus: 'opted_in' | 'opted_out' | 'unknown'
  optedOutAt: string | null
  lastInboundAt: string | null
  createdAt: string
}

export const displayName = (c: { name: string | null; profileName: string | null; waId: string }) =>
  c.name || c.profileName || formatPhone(c.waId)

/** 919812345678 → +91 98123 45678. BSUIDs (usernames) are shown as they are. */
export function formatPhone(waId: string) {
  const m = waId.match(/^91(\d{5})(\d{5})$/)
  return m ? `+91 ${m[1]} ${m[2]}` : /^\d+$/.test(waId) ? `+${waId}` : waId
}
