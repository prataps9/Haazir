import { useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { io, type Socket } from 'socket.io-client'
import { API_BASE } from './api'
import { toast } from './toast'
import type { ConversationSummary, Message } from './types'

type ConvPages = InfiniteData<{ conversations: ConversationSummary[]; nextCursor: string | null }>
type MsgPages = InfiniteData<{ messages: Message[]; nextCursor: string | null }>

/** Puts a message into its conversation's cache: replaces by id, else appends. */
export function upsertMessage(qc: QueryClient, message: Message) {
  qc.setQueryData<MsgPages>(['messages', message.conversationId], (data) => {
    if (!data) return data
    const exists = data.pages.some((p) => p.messages.some((m) => m.id === message.id))
    const pages = data.pages.map((p, i) => {
      if (exists)
        return { ...p, messages: p.messages.map((m) => (m.id === message.id ? message : m)) }
      // Page 0 holds the newest messages (oldest-first inside), so new ones go at its end.
      return i === 0
        ? {
            ...p,
            messages: [...p.messages.filter((m) => !m.pending || m.body !== message.body), message],
          }
        : p
    })
    return { ...data, pages }
  })
}

/** Updates a conversation in every cached list, moving it to the top when it has news. */
export function upsertConversation(qc: QueryClient, conversation: ConversationSummary) {
  qc.setQueriesData<ConvPages>({ queryKey: ['conversations'] }, (data) => {
    if (!data) return data
    const rest = data.pages.map((p) => ({
      ...p,
      conversations: p.conversations.filter((c) => c.id !== conversation.id),
    }))
    const [first, ...others] = rest
    if (!first) return data
    const merged = [conversation, ...first.conversations].sort(
      (a, b) => new Date(b.lastMessageAt ?? 0).getTime() - new Date(a.lastMessageAt ?? 0).getTime(),
    )
    return { ...data, pages: [{ ...first, conversations: merged }, ...others] }
  })
  qc.setQueryData(['conversation', conversation.id], conversation)
}

let socket: Socket | null = null

/**
 * Live inbox (spec §15): joins the org's room and folds events into the
 * query cache, so lists and chats update without polling.
 */
export function useOrgSocket(
  orgId: string | null | undefined,
  labels: { handoff: (name: string) => string },
) {
  const qc = useQueryClient()
  useEffect(() => {
    if (!orgId) return
    socket ??= io(API_BASE || undefined, {
      withCredentials: true,
      transports: ['websocket', 'polling'],
    })
    const s = socket
    const join = () => s.emit('join', orgId)
    join()
    s.on('connect', join)
    const onMessage = (m: Message) => upsertMessage(qc, m)
    const onConversation = (c: ConversationSummary) => upsertConversation(qc, c)
    const onHandoff = (h: { conversationId: string; contactName: string; summary: string }) =>
      toast({
        title: labels.handoff(h.contactName),
        body: h.summary,
        href: `/chat/${h.conversationId}`,
        tone: 'human',
      })
    const onKnowledge = () => void qc.invalidateQueries({ queryKey: ['knowledge'] })
    s.on('message:new', onMessage)
    s.on('message:updated', onMessage)
    s.on('conversation:updated', onConversation)
    s.on('handoff', onHandoff)
    s.on('knowledge:updated', onKnowledge)
    return () => {
      s.off('connect', join)
      s.off('message:new', onMessage)
      s.off('message:updated', onMessage)
      s.off('conversation:updated', onConversation)
      s.off('handoff', onHandoff)
      s.off('knowledge:updated', onKnowledge)
    }
  }, [orgId, qc, labels])
}
