import {
  BellRingingIcon,
  DownloadSimpleIcon,
  MagnifyingGlassIcon,
  UsersThreeIcon,
  WhatsappLogoIcon,
  type Icon,
} from '@phosphor-icons/react'
import { LEAD_STAGES, type LeadSource, type LeadStage } from '@haazir/shared'
import { useState, type DragEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import { Page } from '@/app/Page'
import { Button } from '@/components/Button'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { Select } from '@/components/Select'
import { ListSkeleton } from '@/components/Skeleton'
import { StatusPill } from '@/components/StatusPill'
import { Tabs } from '@/components/Tabs'
import { API_BASE } from '@/lib/api'
import { cn } from '@/lib/cn'
import { crm, useCourses, useCrmMutation, useLeads, type LeadRow } from '@/lib/crm'
import { errorText } from '@/lib/errors'
import { useSession } from '@/lib/session-store'
import { toast } from '@/lib/toast'
import { displayName } from '@/lib/types'
import { LeadSheet, LostReasons } from './LeadSheet'
import { daysIn, followupState, STAGE_TONE } from './leadUi'

const SOURCE_ICON: Partial<Record<LeadSource, Icon>> = { whatsapp: WhatsappLogoIcon }

/**
 * Leads (spec §16.5): phones get the stages as tabs with counts; desktops a
 * Kanban whose cards drag between columns. Dropping on Lost asks why.
 */
export default function LeadsPage() {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const stageParam = LEAD_STAGES.includes(params.get('stage') as LeadStage)
    ? (params.get('stage') as LeadStage)
    : 'new'
  const [q, setQ] = useState('')
  const [course, setCourse] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [losing, setLosing] = useState<string | null>(null)
  const courses = useCourses()
  const leads = useLeads({ q: q.trim(), course })
  const move = useCrmMutation(crm.moveLead)

  const byStage = (s: LeadStage) => leads.data?.leads.filter((l) => l.stage === s) ?? []
  const moveTo = (id: string, stage: LeadStage, lostReason?: string) => {
    if (stage === 'admitted') return setOpen(id) // admission needs a course and a name
    if (stage === 'lost' && !lostReason) return setLosing(id)
    move.mutate(
      { id, stage, lostReason },
      {
        onSuccess: () => toast({ title: t('leads.moved'), tone: 'success' }),
        onError: (err) => toast({ title: errorText(err, t('common.failed')), tone: 'danger' }),
      },
    )
  }

  const exportCsv = async () => {
    // Through fetch, not a link: the org header has to go with it.
    const res = await fetch(`${API_BASE}/api/v1/leads/export`, {
      credentials: 'include',
      headers: { 'x-org-id': useSession.getState().orgId ?? '' },
    })
    if (!res.ok) return toast({ title: t('common.failed'), tone: 'danger' })
    const url = URL.createObjectURL(await res.blob())
    const a = Object.assign(document.createElement('a'), { href: url, download: 'leads.csv' })
    a.click()
    URL.revokeObjectURL(url)
  }

  const toolbar = (
    <div className="flex flex-wrap items-end gap-3">
      <label className="relative min-w-0 flex-1 basis-56">
        <span className="sr-only">{t('leads.search')}</span>
        <MagnifyingGlassIcon
          className="absolute top-1/2 left-3 size-5 -translate-y-1/2 text-ink-muted"
          aria-hidden
        />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('leads.search')}
          className="h-12 w-full rounded-control border border-rule bg-surface pr-3 pl-10 text-body text-ink placeholder:text-ink-muted/80 focus-visible:border-focus focus-visible:outline-2 focus-visible:outline-offset-0"
        />
      </label>
      <Select
        label={t('leads.course')}
        hideLabel
        value={course}
        onChange={(e) => setCourse(e.target.value)}
        className="basis-48"
      >
        <option value="">{t('leads.allCourses')}</option>
        {courses.data?.map((c) => (
          <option key={c.id} value={c.id}>
            {c.shortName}
          </option>
        ))}
      </Select>
      <Button variant="secondary" size="md" onClick={() => void exportCsv()} className="h-12">
        <DownloadSimpleIcon aria-hidden />
        {t('leads.export')}
      </Button>
    </div>
  )

  const empty = leads.data && !leads.data.leads.length && !q && !course

  return (
    <Page title={t('leads.title')}>
      {toolbar}
      <div className="mt-4">
        {leads.isError ? (
          <p className="text-body text-danger-600">{t('common.loadError')}</p>
        ) : leads.isPending ? (
          <ListSkeleton rows={5} />
        ) : empty ? (
          <EmptyState
            icon={UsersThreeIcon}
            title={t('leads.emptyTitle')}
            body={t('leads.emptyBody')}
          />
        ) : (
          <>
            {/* Phones: one stage at a time. */}
            <div className="lg:hidden">
              <Tabs
                label={t('leads.title')}
                value={stageParam}
                onChange={(s) => setParams({ stage: s }, { replace: true })}
                tabs={LEAD_STAGES.map((s) => ({
                  value: s,
                  label: t(`stages.${s}`),
                  count: byStage(s).length,
                }))}
              />
              <ul className="mt-3 flex flex-col gap-2" role="tabpanel">
                {byStage(stageParam).map((l) => (
                  <li key={l.id}>
                    <LeadCard lead={l} onOpen={() => setOpen(l.id)} />
                  </li>
                ))}
                {!byStage(stageParam).length && (
                  <p className="py-6 text-center text-body text-ink-muted">
                    {t('leads.emptyStage')}
                  </p>
                )}
              </ul>
            </div>
            {/* Desktop: the Kanban. */}
            <p className="hidden text-small text-ink-muted lg:block">{t('leads.dragHint')}</p>
            <div className="mt-3 hidden gap-3 overflow-x-auto pb-2 lg:grid lg:grid-cols-6">
              {LEAD_STAGES.map((s) => (
                <Column
                  key={s}
                  stage={s}
                  leads={byStage(s)}
                  onOpen={setOpen}
                  onDrop={(id) => moveTo(id, s)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      <LeadSheet leadId={open} onClose={() => setOpen(null)} />
      <ConfirmDialog
        open={!!losing}
        onOpenChange={(o) => !o && setLosing(null)}
        title={t('leads.whyLost')}
        cancelLabel={t('common.cancel')}
      >
        <LostReasons
          hideLegend
          onPick={(r) => {
            if (losing) moveTo(losing, 'lost', r)
            setLosing(null)
          }}
        />
      </ConfirmDialog>
    </Page>
  )
}

function Column({
  stage,
  leads,
  onOpen,
  onDrop,
}: {
  stage: LeadStage
  leads: LeadRow[]
  onOpen(id: string): void
  onDrop(id: string): void
}) {
  const { t } = useTranslation()
  const [over, setOver] = useState(false)
  const drop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    const id = e.dataTransfer.getData('text/lead')
    if (id) onDrop(id)
  }
  return (
    <section
      aria-label={t(`stages.${stage}`)}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
      className={cn(
        'flex min-h-80 min-w-52 flex-col gap-2 rounded-card border bg-paper p-2 transition-colors duration-150',
        over ? 'border-madder-600 bg-madder-50/50' : 'border-rule',
      )}
    >
      <h2 className="flex items-center justify-between px-1 pt-1 text-body font-semibold text-ink">
        {t(`stages.${stage}`)}
        <span className="rounded-full bg-ink/5 px-2 text-small text-ink-muted tabular">
          {leads.length}
        </span>
      </h2>
      {leads.map((l) => (
        <LeadCard key={l.id} lead={l} onOpen={() => onOpen(l.id)} draggable />
      ))}
    </section>
  )
}

function LeadCard({
  lead,
  onOpen,
  draggable,
}: {
  lead: LeadRow
  onOpen(): void
  draggable?: boolean
}) {
  const { t } = useTranslation()
  const Source = SOURCE_ICON[lead.source]
  const follow = followupState(lead.nextFollowupAt)
  const days = daysIn(lead.stageChangedAt)
  return (
    <button
      type="button"
      onClick={onOpen}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/lead', lead.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      className="flex w-full flex-col gap-1.5 rounded-card border border-rule bg-surface p-3 text-left focus-visible:outline-2 focus-visible:outline-focus"
    >
      <span className="flex items-center gap-1.5">
        {Source && (
          <Source
            className="size-4 shrink-0 text-pottery-600"
            weight="fill"
            aria-label={t(`sources.${lead.source}`)}
          />
        )}
        <span className="truncate text-body font-semibold text-ink">
          {displayName(lead.contact)}
        </span>
      </span>
      {(lead.courseName || lead.studentName) && (
        <span className="truncate text-small text-ink-muted">
          {[lead.courseName, lead.studentName].filter(Boolean).join(' · ')}
        </span>
      )}
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="text-small text-ink-muted">{t('leads.daysInStage', { count: days })}</span>
        {follow === 'overdue' && (
          <StatusPill tone="danger" icon={BellRingingIcon}>
            {t('leads.followupOverdue')}
          </StatusPill>
        )}
        {follow === 'today' && (
          <StatusPill tone="attention" icon={BellRingingIcon}>
            {t('leads.followupToday')}
          </StatusPill>
        )}
        {lead.stage === 'lost' && lead.lostReason && (
          <StatusPill tone={STAGE_TONE.lost}>
            {t(`lostReasons.${lead.lostReason}`, { defaultValue: lead.lostReason })}
          </StatusPill>
        )}
      </span>
    </button>
  )
}
