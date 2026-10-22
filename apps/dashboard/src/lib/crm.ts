import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { FeeStatus, LeadSource, LeadStage } from '@haazir/shared'
import { api, del, patch, post } from './api'
import { useSession } from './session-store'

/** Shapes the coaching routes return (apps/api/src/routes/{courses,leads,demos,students,fees}.ts). */

export interface PlanStep {
  label: string
  amountPaise: number
  dueOffsetDays: number
}

export interface Batch {
  id: string
  courseId: string
  name: string
  days: string[]
  startTime: string
  endTime: string
  startDate: string
  seatsTotal: number
  seatsFilled: number
  demoAllowed: boolean
  branchLabel: string | null
  active: boolean
}

export interface Course {
  id: string
  name: string
  shortName: string
  description: string | null
  durationText: string | null
  mode: 'offline' | 'online' | 'hybrid'
  feeTotalPaise: number
  installmentPlan: PlanStep[]
  certificateText: string | null
  active: boolean
  sort: number
  hasBrochure: boolean
  batches: Batch[]
}

export interface LeadRow {
  id: string
  stage: LeadStage
  source: LeadSource
  courseId: string | null
  courseName: string | null
  batchId: string | null
  studentName: string | null
  notes: string | null
  nextFollowupAt: string | null
  lostReason: string | null
  valuePaise: number | null
  assignedUserId: string | null
  stageChangedAt: string
  createdAt: string
  contact: { id: string; name: string | null; profileName: string | null; waId: string }
  conversationId: string | null
}

export interface LeadEvent {
  id: string
  type: string
  fromStage: LeadStage | null
  toStage: LeadStage | null
  actor: 'bot' | 'user' | 'system'
  actorName: string | null
  note: string | null
  createdAt: string
}

export interface DemoRow {
  id: string
  startsAt: string
  status: 'booked' | 'reminded' | 'attended' | 'no_show' | 'cancelled'
  studentName: string
  bookedBy: 'bot' | 'user' | 'system'
  leadId: string
  courseId: string | null
  courseName: string | null
  batchId: string | null
  batchName: string | null
  contact?: { id: string; name: string | null; profileName: string | null; waId: string }
  conversationId: string | null
}

export interface LeadDetail extends LeadRow {
  events: LeadEvent[]
  demos: DemoRow[]
  students: { id: string; name: string; status: string }[]
}

export interface Installment {
  id: string
  label: string
  dueDate: string
  amountPaise: number
  status: FeeStatus
  paymentLinkUrl: string | null
  paidAt: string | null
  paidVia: string | null
  receiptNo: string | null
}

export interface FeeRow extends Installment {
  student: { id: string; name: string; contactId: string }
  courseName: string | null
  waId: string
  windowOpenUntil: string | null
}

export interface StudentRow {
  id: string
  name: string
  status: string
  rollNo: string | null
  admissionDate: string
  courseName: string | null
  batchName: string | null
  waId: string
  duePaise: number
  paidPaise: number
  nextDue: string | null
}

export interface StudentDetail {
  id: string
  name: string
  status: string
  rollNo: string | null
  admissionDate: string
  contact: { id: string; name: string | null; waId: string }
  course: { id: string; shortName: string; feeTotalPaise: number } | null
  batch: { id: string; name: string } | null
  guardian: { id: string; name: string | null; waId: string } | null
  installments: Installment[]
}

export interface Summary {
  range: 'today' | 'yesterday' | 'week'
  from: string
  today: string
  enquiries: number
  botReplies: number
  avgReplySeconds: number | null
  demosBooked: number
  admissions: number
  feesCollectedPaise: number
  waitingChats: number
  unansweredCount: number
  demos: Pick<
    DemoRow,
    'id' | 'startsAt' | 'status' | 'studentName' | 'courseName' | 'batchName' | 'conversationId'
  >[]
  feesDue: {
    id: string
    label: string
    dueDate: string
    amountPaise: number
    status: FeeStatus
    studentName: string
    courseName: string | null
  }[]
}

export interface Org {
  id: string
  name: string
  displayName: string
  city: string | null
  state: string | null
  address: string | null
  mapsUrl: string | null
  latitude: number | null
  longitude: number | null
  phone: string | null
  defaultLanguage: 'hi' | 'en' | 'hinglish'
  businessHours: Record<string, { open: string; close: string } | null> | null
  status: string
  onboardingStep: number
  whatsapp: {
    status: string
    displayPhone: string | null
    verifiedName: string | null
    qualityRating: string | null
  } | null
  paymentsConnected: boolean
}

const useOrgId = () => useSession((s) => s.orgId) ?? undefined

export const useCourses = () => {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ['courses', orgId],
    enabled: !!orgId,
    queryFn: () => api<{ courses: Course[] }>('/api/v1/courses').then((r) => r.courses),
  })
}

export const useLeads = (filters: { stage?: string; course?: string; q?: string } = {}) => {
  const orgId = useOrgId()
  const params = new URLSearchParams(
    Object.entries(filters).filter(([, v]) => v) as [string, string][],
  )
  return useQuery({
    queryKey: ['leads', orgId, params.toString()],
    enabled: !!orgId,
    queryFn: () =>
      api<{ leads: LeadRow[]; counts: Record<LeadStage, number> }>(`/api/v1/leads?${params}`),
  })
}

export const useLead = (id: string | null | undefined) =>
  useQuery({
    queryKey: ['lead', id],
    enabled: !!id,
    queryFn: () => api<LeadDetail>(`/api/v1/leads/${id}`),
  })

/** The lead for a chat's contact, found through the leads list (one per contact). */
export const useLeadForContact = (contactId: string | undefined) => {
  const leads = useLeads()
  return leads.data?.leads.find((l) => l.contact.id === contactId) ?? null
}

export const useSummary = (range: Summary['range']) => {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ['summary', orgId, range],
    enabled: !!orgId,
    queryFn: () => api<Summary>(`/api/v1/analytics/summary?range=${range}`),
  })
}

export const useFees = (status: string, month?: string) => {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ['fees', orgId, status, month ?? ''],
    enabled: !!orgId,
    queryFn: () =>
      api<{
        fees: FeeRow[]
        summary: {
          dueThisMonthPaise: number
          collectedThisMonthPaise: number
          overduePaise: number
        }
      }>(`/api/v1/fees?status=${status}${month ? `&month=${month}` : ''}`),
  })
}

export const useStudent = (id: string | null) =>
  useQuery({
    queryKey: ['student', id],
    enabled: !!id,
    queryFn: () => api<StudentDetail>(`/api/v1/students/${id}`),
  })

export const useOrg = () => {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ['org', orgId],
    enabled: !!orgId,
    queryFn: () => api<Org>('/api/v1/org'),
  })
}

/** A write that refreshes every coaching list: they're small, and stale numbers mislead. */
export function useCrmMutation<V, R>(fn: (vars: V) => Promise<R>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      for (const key of [
        'courses',
        'leads',
        'lead',
        'demos',
        'summary',
        'fees',
        'student',
        'students',
        'org',
        'conversations',
        'conversation',
      ])
        void qc.invalidateQueries({ queryKey: [key] })
    },
  })
}

export const crm = {
  saveCourse: (body: Partial<Course> & { id?: string }) =>
    body.id
      ? patch<Course>(`/api/v1/courses/${body.id}`, body)
      : post<Course>('/api/v1/courses', body),
  uploadBrochure: ({ courseId, file }: { courseId: string; file: File }) => {
    const form = new FormData()
    form.set('file', file)
    return post(`/api/v1/courses/${courseId}/brochure`, form)
  },
  saveBatch: (body: Partial<Batch> & { id?: string }) =>
    body.id
      ? patch<Batch>(`/api/v1/batches/${body.id}`, body)
      : post<Batch>('/api/v1/batches', body),
  moveLead: ({ id, ...body }: { id: string; stage: LeadStage; lostReason?: string }) =>
    post<LeadRow>(`/api/v1/leads/${id}/stage`, body),
  updateLead: ({
    id,
    ...body
  }: { id: string } & Partial<
    Pick<LeadRow, 'courseId' | 'studentName' | 'notes' | 'nextFollowupAt'>
  >) => patch<LeadRow>(`/api/v1/leads/${id}`, body),
  admit: ({
    id,
    ...body
  }: {
    id: string
    name: string
    courseId: string
    batchId?: string | null
    admissionDate?: string
  }) => post(`/api/v1/leads/${id}/admit`, body),
  bookDemo: (body: { leadId: string; batchId: string; date: string; studentName: string }) =>
    post<DemoRow>('/api/v1/demos', body),
  markDemo: ({ id, status }: { id: string; status: 'attended' | 'no_show' | 'cancelled' }) =>
    patch<DemoRow>(`/api/v1/demos/${id}`, { status }),
  sendLink: (id: string) =>
    post<{ sent: boolean; reason?: string; link: string | null }>(`/api/v1/fees/${id}/link`, {}),
  remind: (id: string) => post<{ sent: boolean; reason?: string }>(`/api/v1/fees/${id}/remind`),
  markPaid: ({
    id,
    ...body
  }: {
    id: string
    via: 'cash' | 'upi_manual' | 'bank'
    receiptNo?: string
  }) => post<FeeRow>(`/api/v1/fees/${id}/mark-paid`, body),
  remindOverdue: (dryRun: boolean) =>
    post<{
      count?: number
      needsTemplate?: number
      inWindow?: number
      sent?: number
      skipped?: Record<string, number>
    }>('/api/v1/fees/remind-overdue', { dryRun }),
  admitWalkIn: (body: {
    name: string
    phone: string
    courseId: string
    batchId?: string | null
    guardianPhone?: string
  }) => post('/api/v1/students', body),
  updateOrg: (body: Partial<Org>) => patch<Org>('/api/v1/org', body),
  onboardingStep: (body: { step: number; done?: boolean }) =>
    patch<Org>('/api/v1/org/onboarding', body),
  connectPayments: (body: { keyId: string; keySecret: string; webhookSecret: string }) =>
    api('/api/v1/org/payments', { method: 'PUT', body: JSON.stringify(body) }),
  disconnectPayments: () => del('/api/v1/org/payments'),
}
