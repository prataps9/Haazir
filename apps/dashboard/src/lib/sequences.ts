import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SequenceTrigger, TemplateCategory, TemplatePurpose } from '@haazir/shared'
import { api, put } from './api'
import { useSession } from './session-store'

/** Shapes the sequences route returns (apps/api/src/routes/sequences.ts). */

export interface SequenceStep {
  delayHours: number
  templateId: string | null
  /** False when the template was deleted or lost its approval. */
  usable: boolean
}

export interface SequenceView {
  trigger: SequenceTrigger
  enabled: boolean
  steps: SequenceStep[]
  /** The most one lead can cost at Meta's rates today, in paise. */
  maxCostPaisePerLead: number
  counts: { active: number; done: number; stopped: number }
}

export interface SequenceTemplate {
  id: string
  name: string
  language: string
  category: TemplateCategory
  purpose: TemplatePurpose
  body: string
}

export interface SequencesData {
  sequences: SequenceView[]
  templates: SequenceTemplate[]
  maxSteps: number
  /** Meta's rate per message today, centipaise, by category. */
  rates: Record<string, number>
}

export const useSequences = () => {
  const orgId = useSession((s) => s.orgId) ?? undefined
  return useQuery({
    queryKey: ['sequences', orgId],
    enabled: !!orgId,
    queryFn: () => api<SequencesData>('/api/v1/sequences'),
  })
}

export function useSaveSequence() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      trigger,
      ...body
    }: {
      trigger: SequenceTrigger
      enabled: boolean
      steps: { delayHours: number; templateId: string }[]
    }) => put<SequenceView>(`/api/v1/sequences/${trigger}`, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['sequences'] }),
  })
}
