import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query'
import { api, patch, post } from '@/lib/api'
import { upsertConversation, upsertMessage } from '@/lib/socket'
import type { Contact, ConversationSummary, Message } from '@/lib/types'

export type Filter = 'all' | 'human' | 'unread'

export function useConversations(orgId: string | undefined, filter: Filter, q: string) {
  return useInfiniteQuery({
    queryKey: ['conversations', orgId, filter, q],
    enabled: !!orgId,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams()
      if (filter === 'human') params.set('mode', 'human')
      if (filter === 'unread') params.set('unread', 'true')
      if (q) params.set('q', q)
      if (pageParam) params.set('cursor', pageParam)
      return api<{ conversations: ConversationSummary[]; nextCursor: string | null }>(
        `/api/v1/conversations?${params}`,
      )
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
}

export function useConversation(id: string | undefined) {
  return useQuery({
    queryKey: ['conversation', id],
    enabled: !!id,
    queryFn: () => api<ConversationSummary>(`/api/v1/conversations/${id}`),
  })
}

/** Page 0 = newest messages (oldest first inside); later pages are older. */
export function useMessages(conversationId: string | undefined) {
  return useInfiniteQuery({
    queryKey: ['messages', conversationId],
    enabled: !!conversationId,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api<{ messages: Message[]; nextCursor: string | null }>(
        `/api/v1/conversations/${conversationId}/messages${pageParam ? `?cursor=${pageParam}` : ''}`,
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 10_000,
  })
}

export function useContact(id: string | undefined) {
  return useQuery({
    queryKey: ['contact', id],
    enabled: !!id,
    queryFn: () => api<Contact>(`/api/v1/contacts/${id}`),
  })
}

type MsgPages = InfiniteData<{ messages: Message[]; nextCursor: string | null }>

/** Staff reply, shown immediately (optimistic) and replaced by the server's copy. */
export function useSendMessage(conversationId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (text: string) =>
      post<Message>(`/api/v1/conversations/${conversationId}/messages`, { text }),
    onMutate: async (text) => {
      await qc.cancelQueries({ queryKey: ['messages', conversationId] })
      const temp: Message = {
        id: `pending-${Date.now()}`,
        conversationId,
        direction: 'out',
        type: 'text',
        body: text,
        transcript: null,
        status: 'queued',
        errorCode: null,
        errorTitle: null,
        sentBy: 'user',
        sentByUserId: null,
        mediaMime: null,
        hasMedia: false,
        interactive: null,
        createdAt: new Date().toISOString(),
        pending: true,
      }
      upsertMessage(qc, temp)
      return { tempId: temp.id }
    },
    onSuccess: (message, _text, ctx) => {
      qc.setQueryData<MsgPages>(
        ['messages', conversationId],
        (data) =>
          data && {
            ...data,
            pages: data.pages.map((p) => ({
              ...p,
              messages: p.messages.filter((m) => m.id !== ctx?.tempId && m.id !== message.id),
            })),
          },
      )
      upsertMessage(qc, message)
    },
    onError: (_err, _text, ctx) => {
      qc.setQueryData<MsgPages>(
        ['messages', conversationId],
        (data) =>
          data && {
            ...data,
            pages: data.pages.map((p) => ({
              ...p,
              messages: p.messages.filter((m) => m.id !== ctx?.tempId),
            })),
          },
      )
    },
  })
}

export function useModeChange(conversationId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (to: 'human' | 'bot') =>
      post<ConversationSummary>(
        `/api/v1/conversations/${conversationId}/${to === 'human' ? 'takeover' : 'handback'}`,
      ),
    onSuccess: (conversation) => upsertConversation(qc, conversation),
  })
}

export function useMarkRead(conversationId: string | undefined) {
  return useMutation({ mutationFn: () => post(`/api/v1/conversations/${conversationId}/read`) })
}

export function useUpdateContact(contactId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Partial<Pick<Contact, 'name' | 'tags' | 'notes'>>) =>
      patch<Contact>(`/api/v1/contacts/${contactId}`, body),
    onSuccess: (contact) => {
      qc.setQueryData(['contact', contactId], contact)
      void qc.invalidateQueries({ queryKey: ['conversations'] })
    },
  })
}
