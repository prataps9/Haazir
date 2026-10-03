import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, del, patch, post } from '@/lib/api'

export type SourceType = 'faq' | 'text' | 'pdf' | 'url'
export type SourceStatus = 'pending' | 'processing' | 'ready' | 'failed'

export interface Source {
  id: string
  type: SourceType
  title: string
  url: string | null
  status: SourceStatus
  error: string | null
  chunkCount: number
  createdAt: string
}

export interface Faq {
  id: string
  question: string
  answer: string
  sourceId: string
  updatedAt: string
}

export interface Unanswered {
  id: string
  question: string
  count: number
  lastSeenAt: string
}

export interface BotConfig {
  enabled: boolean
  personaName: string
  tone: 'warm' | 'formal'
  greeting: Localised
  mainMenu: { id: 'menu_courses' | 'menu_demo' | 'menu_talk'; title: Localised }[]
  handoffKeywords: string[]
  optoutKeywords: string[]
  afterHoursMessage: Localised
  fallbackMessage: Localised
  competitorNames: string[]
  maxAiRepliesPerContactHour: number
  aiConfigured: boolean
}
export type Localised = { hi?: string; en?: string; hinglish?: string }

const key = (orgId: string | undefined, ...rest: string[]) => ['knowledge', orgId, ...rest]
const busy = (s: Source) => s.status === 'pending' || s.status === 'processing'

export function useSources(orgId: string | undefined) {
  return useQuery({
    queryKey: key(orgId, 'sources'),
    enabled: !!orgId,
    queryFn: () => api<{ sources: Source[] }>('/api/v1/knowledge/sources').then((r) => r.sources),
    // Socket events refresh this too; the poll covers a dropped connection while learning.
    refetchInterval: (q) => (q.state.data?.some(busy) ? 5000 : false),
  })
}

export function useFaqs(orgId: string | undefined) {
  return useQuery({
    queryKey: key(orgId, 'faqs'),
    enabled: !!orgId,
    queryFn: () => api<{ faqs: Faq[] }>('/api/v1/knowledge/faqs').then((r) => r.faqs),
  })
}

export function useUnanswered(orgId: string | undefined) {
  return useQuery({
    queryKey: key(orgId, 'unanswered'),
    enabled: !!orgId,
    queryFn: () =>
      api<{ questions: Unanswered[] }>('/api/v1/knowledge/unanswered').then((r) => r.questions),
  })
}

export function useBotConfig(orgId: string | undefined) {
  return useQuery({
    queryKey: ['bot', orgId],
    enabled: !!orgId,
    queryFn: () => api<BotConfig>('/api/v1/bot'),
  })
}

/** Every knowledge write refreshes every knowledge list: they're small. */
function useKnowledgeMutation<V, R>(fn: (vars: V) => Promise<R>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['knowledge'] }),
  })
}

export type NewSource =
  | { type: 'text'; title: string; text: string }
  | { type: 'url'; url: string }
  | { type: 'pdf'; file: File; title?: string }

export const useAddSource = () =>
  useKnowledgeMutation((body: NewSource) => {
    if (body.type !== 'pdf') return post<Source>('/api/v1/knowledge/sources', body)
    const form = new FormData()
    form.set('file', body.file)
    if (body.title) form.set('title', body.title)
    return post<Source>('/api/v1/knowledge/sources', form)
  })

export const useDeleteSource = () =>
  useKnowledgeMutation((id: string) => del<void>(`/api/v1/knowledge/sources/${id}`))

export const useSaveFaq = () =>
  useKnowledgeMutation(({ id, ...body }: { id?: string; question: string; answer: string }) =>
    id
      ? patch<Faq>(`/api/v1/knowledge/faqs/${id}`, body)
      : post<Faq>('/api/v1/knowledge/faqs', body),
  )

export const useDeleteFaq = () =>
  useKnowledgeMutation((id: string) => del<void>(`/api/v1/knowledge/faqs/${id}`))

export const useResolveUnanswered = () =>
  useKnowledgeMutation(({ id, ...body }: { id: string; answer: string; question: string }) =>
    post<Faq>(`/api/v1/knowledge/unanswered/${id}/resolve`, body),
  )
