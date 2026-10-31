import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  CampaignAudience,
  CampaignStatus,
  CampaignVariable,
  PricingCategory,
  TemplateButton,
  TemplateCategory,
  TemplatePurpose,
  TemplateStatus,
} from '@haazir/shared'
import { api, del, patch, post } from './api'
import { useSession } from './session-store'

/** Shapes the Phase 5 routes return (apps/api/src/routes/{templates,campaigns,analytics}.ts). */

export interface TemplateView {
  id: string
  name: string
  language: string
  category: TemplateCategory
  status: TemplateStatus
  rejectionReason: string | null
  purpose: TemplatePurpose
  variables: string[]
  variableCount: number
  header?: string
  body: string
  footer?: string
  buttons?: TemplateButton[]
  /** Meta's rules this one breaks (keys under templates.problems.*). */
  problems: string[]
  submitted: boolean
  updatedAt: string
}

export interface CampaignStats {
  recipients: number
  sent: number
  delivered: number
  read: number
  failed: number
}

export interface CampaignResults extends CampaignStats {
  pending: number
  replied: number
  skipped: number
  failures: { code: string; title: string | null; count: number }[]
  actualCostPaise: number
  actualGstPaise: number
}

export interface CampaignView {
  id: string
  name: string
  status: CampaignStatus
  audience: CampaignAudience
  variableMap: CampaignVariable[]
  scheduledAt: string | null
  startedAt: string | null
  finishedAt: string | null
  estimatedRecipients: number | null
  estimatedCostPaise: number | null
  createdAt: string
  template:
    | (Pick<TemplateView, 'id' | 'name' | 'language' | 'category' | 'status' | 'variableCount'> & {
        header?: string
        body: string
        footer?: string
        buttons?: TemplateButton[]
      })
    | null
  stats?: CampaignStats | null
  results?: CampaignResults | null
}

export interface AudienceCount {
  count: number
  optedOut: number
  noConsent: number
}

export interface Estimate extends AudienceCount {
  recipients: number
  category: TemplateCategory
  rateCentipaise: number
  costPaise: number
  gstPaise: number
  /** How many people the number may start chats with per day, if Meta told us. */
  tierLimit: number | null
}

export interface Report {
  days: 7 | 30 | 90
  from: string
  to: string
  tiles: {
    enquiries: number
    demosBooked: number
    admissions: number
    feesCollectedPaise: number
    medianFirstReplySeconds: number | null
    conversionPercent: number | null
    messageCostPaise: number
    messageGstPaise: number
  }
  enquiriesPerDay: { day: string; n: number }[]
  funnel: { enquiries: number; demos: number; admitted: number; fromCampaigns: number }
  topCourses: { course: string; n: number }[]
  /** weekday 1 = Monday … 7 = Sunday; hour 0–23, India time. */
  heatmap: { weekday: number; hour: number; n: number }[]
  costs: { category: PricingCategory; sent: number; billable: number; costPaise: number }[]
}

export interface ChatTemplate {
  id: string
  name: string
  language: string
  category: TemplateCategory
  purpose: TemplatePurpose
  /** In the language this person reads (or the owner's own template). */
  preferred: boolean
  body: string
  variables: string[]
  suggested: string[]
}

const useOrgId = () => useSession((s) => s.orgId) ?? undefined

export const useTemplates = () => {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ['templates', orgId],
    enabled: !!orgId,
    queryFn: () => api<{ templates: TemplateView[]; hasNumber: boolean }>('/api/v1/templates'),
  })
}

export const useCampaigns = () => {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ['campaigns', orgId],
    enabled: !!orgId,
    queryFn: () => api<{ campaigns: CampaignView[] }>('/api/v1/campaigns').then((r) => r.campaigns),
  })
}

export const useCampaign = (id: string | undefined) => {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ['campaign', orgId, id],
    enabled: !!orgId && !!id,
    queryFn: () => api<CampaignView>(`/api/v1/campaigns/${id}`),
    // Results fill in as Meta's statuses arrive; a live event also refreshes it.
    refetchInterval: (q) =>
      q.state.data?.status === 'sending' || q.state.data?.status === 'scheduled' ? 15_000 : false,
  })
}

export const useAudienceCount = (audience: CampaignAudience) => {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ['audience', orgId, audience],
    enabled: !!orgId,
    queryFn: () => post<AudienceCount>('/api/v1/campaigns/audience-count', { audience }),
    placeholderData: (previous) => previous,
  })
}

export const useEstimate = (id: string | undefined, key: unknown) => {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ['estimate', orgId, id, key],
    enabled: !!orgId && !!id,
    queryFn: () => post<Estimate>(`/api/v1/campaigns/${id}/estimate`),
    retry: false,
  })
}

export const usePreview = (id: string | undefined, key: unknown) => {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ['campaign-preview', orgId, id, key],
    enabled: !!orgId && !!id,
    queryFn: () =>
      api<{ contact: { id: string; name: string | null; waId: string } | null; text: string }>(
        `/api/v1/campaigns/${id}/preview`,
      ),
    retry: false,
  })
}

export const useReport = (days: Report['days']) => {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ['report', orgId, days],
    enabled: !!orgId,
    queryFn: () => api<Report>(`/api/v1/analytics/report?days=${days}`),
  })
}

export const useChatTemplates = (conversationId: string, enabled: boolean) => {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ['chat-templates', orgId, conversationId],
    enabled: !!orgId && enabled,
    queryFn: () =>
      api<{ templates: ChatTemplate[] }>(`/api/v1/conversations/${conversationId}/templates`).then(
        (r) => r.templates,
      ),
  })
}

export interface TemplateInput {
  name?: string
  language?: 'hi' | 'en'
  category?: 'utility' | 'marketing'
  header?: string | null
  body?: string
  footer?: string | null
  buttons?: TemplateButton[]
  variables?: string[]
}

export const growth = {
  saveTemplate: ({ id, ...body }: TemplateInput & { id?: string }) =>
    id
      ? patch<TemplateView>(`/api/v1/templates/${id}`, body)
      : post<TemplateView>('/api/v1/templates', body),
  submitTemplate: (id: string) => post<TemplateView>(`/api/v1/templates/${id}/submit`),
  submitAll: () =>
    post<{ submitted: number; failed: { id: string; name: string; message: string }[] }>(
      '/api/v1/templates/submit-all',
    ),
  syncTemplates: () => post<{ changed: number; added: number }>('/api/v1/templates/sync'),
  deleteTemplate: (id: string) => del(`/api/v1/templates/${id}`),
  saveCampaign: ({
    id,
    ...body
  }: {
    id?: string
    name?: string
    templateId?: string | null
    audience?: CampaignAudience
    variableMap?: CampaignVariable[]
  }) =>
    id
      ? patch<CampaignView>(`/api/v1/campaigns/${id}`, body)
      : post<CampaignView>('/api/v1/campaigns', body),
  deleteCampaign: (id: string) => del(`/api/v1/campaigns/${id}`),
  scheduleCampaign: ({ id, at }: { id: string; at?: string }) =>
    post<CampaignView>(`/api/v1/campaigns/${id}/schedule`, at ? { at } : {}),
  cancelCampaign: (id: string) => post<CampaignView>(`/api/v1/campaigns/${id}/cancel`),
  sendChatTemplate: ({
    conversationId,
    ...body
  }: {
    conversationId: string
    templateId: string
    values: string[]
  }) => post(`/api/v1/conversations/${conversationId}/template`, body),
}

/** A mutation that refreshes everything templates and campaigns show. */
export function useGrowthMutation<V, R>(fn: (vars: V) => Promise<R>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      for (const key of [
        'templates',
        'campaigns',
        'campaign',
        'estimate',
        'campaign-preview',
        'audience',
        'chat-templates',
      ])
        void qc.invalidateQueries({ queryKey: [key] })
    },
  })
}
