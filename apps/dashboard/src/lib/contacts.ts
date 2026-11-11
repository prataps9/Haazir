import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CampaignAudience, LeadStage } from '@haazir/shared'
import { api, del, post } from './api'
import { useSession } from './session-store'

/** Shapes the contacts and segments routes return (apps/api/src/routes/{contacts,segments}.ts). */

export type Consent = 'opted_in' | 'opted_out' | 'unknown'

export interface ContactRow {
  id: string
  waId: string
  name: string | null
  profileName: string | null
  tags: string[]
  optInStatus: Consent
  optInSource: string | null
  stage: LeadStage | null
  createdAt: string
}

export interface ContactFilters {
  q?: string
  tag?: string
  stage?: LeadStage
  consent?: Consent
}

export interface Segment {
  id: string
  name: string
  filters: CampaignAudience
  /** Who a campaign to this segment would reach today, and who is left out. */
  count: number
  optedOut: number
  noConsent: number
}

export interface ImportRow {
  phone: string
  name?: string
  tags?: string[]
  consent?: boolean
}

export interface ImportResult {
  created: number
  updated: number
  unchanged: number
  optedIn: number
  /** Row numbers (1-based) whose phone number couldn't be read; the first 50. */
  invalid: number[]
  invalidCount: number
}

const useOrgId = () => useSession((s) => s.orgId) ?? undefined

export function contactParams(filters: ContactFilters, page?: number) {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v)
  if (page) params.set('page', String(page))
  return params
}

export const useContacts = (filters: ContactFilters, page: number) => {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ['contacts', orgId, filters, page],
    enabled: !!orgId,
    placeholderData: keepPreviousData,
    queryFn: () =>
      api<{ contacts: ContactRow[]; total: number; page: number; pageSize: number }>(
        `/api/v1/contacts?${contactParams(filters, page)}`,
      ),
  })
}

export const useContactTags = () => {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ['contacts', orgId, 'tags'],
    enabled: !!orgId,
    queryFn: () =>
      api<{ tags: { tag: string; count: number }[] }>('/api/v1/contacts/tags').then((r) => r.tags),
  })
}

export const useSegments = (enabled = true) => {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ['segments', orgId],
    enabled: !!orgId && enabled,
    queryFn: () => api<{ segments: Segment[] }>('/api/v1/segments').then((r) => r.segments),
  })
}

/** Contacts and segment counts both change when tags or consent do. */
function useRefresh() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['contacts'] })
    void qc.invalidateQueries({ queryKey: ['segments'] })
  }
}

export function useBulkTag() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (body: { ids: string[]; add?: string[]; remove?: string[] }) =>
      post<{ updated: number }>('/api/v1/contacts/bulk-tag', body),
    onSuccess: refresh,
  })
}

export function useImportContacts() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (body: { rows: ImportRow[]; tags: string[]; consentDeclared: boolean }) =>
      post<ImportResult>('/api/v1/contacts/import', body),
    onSuccess: refresh,
  })
}

export function useSaveSegment() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (body: { name: string; filters: CampaignAudience }) =>
      post<Segment>('/api/v1/segments', body),
    onSuccess: refresh,
  })
}

export function useDeleteSegment() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (id: string) => del(`/api/v1/segments/${id}`),
    onSuccess: refresh,
  })
}

/**
 * CSV as spreadsheets write it: commas, quoted cells, doubled quotes inside
 * them, either line ending, and the byte-order mark Excel adds.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const src = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"' && cell === '') quoted = true
    else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

const HEADERS = {
  phone: ['phone', 'mobile', 'whatsapp', 'number', 'contact', 'फ़ोन', 'फोन', 'मोबाइल', 'नंबर'],
  name: ['name', 'नाम'],
  tags: ['tags', 'tag', 'टैग'],
  consent: ['consent', 'updates', 'opt in', 'opt-in', 'optin', 'सहमति'],
} as const
const YES = new Set(['yes', 'y', 'true', '1', 'haan', 'han', 'हाँ', 'हां', 'opted_in'])

/**
 * Turns a parsed sheet into import rows. The first row is the header when it
 * names a phone column; otherwise the first column is taken as the number and
 * the second as the name.
 */
export function rowsFromCsv(table: string[][]): { rows: ImportRow[]; hasConsentColumn: boolean } {
  if (!table.length) return { rows: [], hasConsentColumn: false }
  const head = table[0]!.map((h) => h.trim().toLowerCase())
  const find = (names: readonly string[]) => head.findIndex((h) => names.some((n) => h.includes(n)))
  const phoneAt = find(HEADERS.phone)
  const hasHeader = phoneAt >= 0
  const col = hasHeader
    ? {
        phone: phoneAt,
        name: find(HEADERS.name),
        tags: find(HEADERS.tags),
        consent: find(HEADERS.consent),
      }
    : { phone: 0, name: 1, tags: -1, consent: -1 }
  const rows = table.slice(hasHeader ? 1 : 0).map((r) => {
    const tags = (r[col.tags] ?? '')
      .split(/[;|]/)
      .map((s) => s.trim())
      .filter(Boolean)
    return {
      phone: (r[col.phone] ?? '').trim(),
      name: r[col.name]?.trim() || undefined,
      tags: tags.length ? tags.slice(0, 20) : undefined,
      consent: col.consent >= 0 ? YES.has((r[col.consent] ?? '').trim().toLowerCase()) : undefined,
    }
  })
  return { rows: rows.filter((r) => r.phone), hasConsentColumn: col.consent >= 0 }
}
