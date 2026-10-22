import { CalendarPlusIcon, ChatsCircleIcon, GraduationCapIcon } from '@phosphor-icons/react'
import { LEAD_STAGES, LOST_REASONS, type LeadStage } from '@haazir/shared'
import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Avatar } from '@/components/Avatar'
import { Button } from '@/components/Button'
import { Input } from '@/components/Input'
import { Select } from '@/components/Select'
import { Sheet } from '@/components/Sheet'
import { Skeleton } from '@/components/Skeleton'
import { StatusPill } from '@/components/StatusPill'
import { Textarea } from '@/components/Textarea'
import { crm, useCourses, useCrmMutation, useLead, type LeadDetail } from '@/lib/crm'
import { errorText } from '@/lib/errors'
import { usePreferences } from '@/lib/preferences'
import { clock, dayLabel } from '@/lib/time'
import { toast } from '@/lib/toast'
import { displayName, formatPhone } from '@/lib/types'
import { STAGE_TONE } from './leadUi'

const istToday = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10)

/** Lead detail (spec §16.5): who, what they want, the timeline, and the next step. */
export function LeadSheet({ leadId, onClose }: { leadId: string | null; onClose(): void }) {
  const { t } = useTranslation()
  const lead = useLead(leadId)
  const l = lead.data
  return (
    <Sheet
      open={!!leadId}
      onOpenChange={(open) => !open && onClose()}
      title={l ? displayName(l.contact) : t('common.loading')}
      closeLabel={t('common.close')}
    >
      <div className="flex flex-col gap-6 px-5 pt-1 pb-8">
        {lead.isError && <p className="text-body text-danger-600">{t('common.loadError')}</p>}
        {!l ? <Skeleton className="h-40" /> : <LeadBody lead={l} key={l.id} />}
      </div>
    </Sheet>
  )
}

function LeadBody({ lead }: { lead: LeadDetail }) {
  const { t } = useTranslation()
  const [panel, setPanel] = useState<'demo' | 'admit' | null>(null)
  return (
    <>
      <div className="flex items-center gap-3">
        <Avatar name={displayName(lead.contact)} />
        <div className="min-w-0 flex-1">
          <p className="text-small text-ink-muted tabular">{formatPhone(lead.contact.waId)}</p>
          <div className="mt-1 flex flex-wrap gap-2">
            <StatusPill tone={STAGE_TONE[lead.stage]}>{t(`stages.${lead.stage}`)}</StatusPill>
            <StatusPill tone="neutral">{t(`sources.${lead.source}`)}</StatusPill>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {lead.conversationId && (
          <Button asChild variant="secondary" size="md">
            <Link to={`/chat/${lead.conversationId}`}>
              <ChatsCircleIcon aria-hidden />
              {t('leads.openChat')}
            </Link>
          </Button>
        )}
        {lead.stage !== 'admitted' && (
          <>
            <Button
              variant="secondary"
              size="md"
              onClick={() => setPanel(panel === 'demo' ? null : 'demo')}
            >
              <CalendarPlusIcon aria-hidden />
              {t('leads.bookDemo')}
            </Button>
            <Button size="md" onClick={() => setPanel(panel === 'admit' ? null : 'admit')}>
              <GraduationCapIcon aria-hidden />
              {t('leads.admit')}
            </Button>
          </>
        )}
      </div>

      {panel === 'demo' && <BookDemoForm lead={lead} onDone={() => setPanel(null)} />}
      {panel === 'admit' && <AdmitForm lead={lead} onDone={() => setPanel(null)} />}

      <MoveStage lead={lead} />
      <LeadFields lead={lead} />
      {lead.demos.length > 0 && <Demos lead={lead} />}
      <Timeline lead={lead} />
    </>
  )
}

function MoveStage({ lead }: { lead: LeadDetail }) {
  const { t } = useTranslation()
  const move = useCrmMutation(crm.moveLead)
  const [lost, setLost] = useState(false)
  const go = (stage: LeadStage, lostReason?: string) =>
    move.mutate(
      { id: lead.id, stage, lostReason },
      {
        onSuccess: () => {
          setLost(false)
          toast({ title: t('leads.moved'), tone: 'success' })
        },
        onError: (err) => toast({ title: errorText(err, t('common.failed')), tone: 'danger' }),
      },
    )
  if (lead.stage === 'admitted') return null
  return (
    <section className="flex flex-col gap-3">
      <Select
        label={t('leads.move')}
        value={lead.stage}
        disabled={move.isPending}
        onChange={(e) => {
          const stage = e.target.value as LeadStage
          if (stage === 'lost') setLost(true)
          else go(stage)
        }}
      >
        {LEAD_STAGES.filter((s) => s !== 'admitted').map((s) => (
          <option key={s} value={s}>
            {t(`stages.${s}`)}
          </option>
        ))}
      </Select>
      {lost && <LostReasons onPick={(r) => go('lost', r)} />}
    </section>
  )
}

/** "Fees zyada, Door hai, Doosri jagah, Jawab nahi, Other" (spec §16.5). */
export function LostReasons({
  onPick,
  hideLegend,
}: {
  onPick(reason: string): void
  hideLegend?: boolean
}) {
  const { t } = useTranslation()
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className={hideLegend ? 'sr-only' : 'mb-1 text-small font-semibold text-ink'}>
        {t('leads.whyLost')}
      </legend>
      <div className="flex flex-wrap gap-2">
        {LOST_REASONS.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => onPick(r)}
            className="min-h-11 rounded-full border border-rule bg-surface px-4 text-body text-ink transition-colors duration-150 hover:border-ink-muted/60"
          >
            {t(`lostReasons.${r}`)}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

function LeadFields({ lead }: { lead: LeadDetail }) {
  const { t } = useTranslation()
  const courses = useCourses()
  const save = useCrmMutation(crm.updateLead)
  const [studentName, setStudentName] = useState(lead.studentName ?? '')
  const [courseId, setCourseId] = useState(lead.courseId ?? '')
  const [notes, setNotes] = useState(lead.notes ?? '')
  const [followup, setFollowup] = useState(
    lead.nextFollowupAt ? lead.nextFollowupAt.slice(0, 10) : '',
  )
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate(
      {
        id: lead.id,
        studentName: studentName || null,
        courseId: courseId || null,
        notes: notes || null,
        // A follow-up is a day: 10 AM that day, India time.
        nextFollowupAt: followup ? new Date(`${followup}T10:00:00+05:30`).toISOString() : null,
      },
      {
        onSuccess: () => toast({ title: t('leads.saved'), tone: 'success' }),
        onError: (err) => toast({ title: errorText(err, t('common.failed')), tone: 'danger' }),
      },
    )
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Input
        label={t('leads.studentName')}
        value={studentName}
        onChange={(e) => setStudentName(e.target.value)}
        maxLength={80}
      />
      <Select
        label={t('leads.course')}
        value={courseId}
        onChange={(e) => setCourseId(e.target.value)}
      >
        <option value="">—</option>
        {courses.data?.map((c) => (
          <option key={c.id} value={c.id}>
            {c.shortName}
          </option>
        ))}
      </Select>
      <Input
        label={t('leads.nextFollowup')}
        type="date"
        value={followup}
        onChange={(e) => setFollowup(e.target.value)}
      />
      <Textarea
        label={t('leads.notes')}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        maxLength={2000}
        rows={3}
      />
      <Button
        type="submit"
        variant="secondary"
        size="md"
        className="self-start"
        loading={save.isPending}
      >
        {t('leads.save')}
      </Button>
    </form>
  )
}

function BookDemoForm({ lead, onDone }: { lead: LeadDetail; onDone(): void }) {
  const { t } = useTranslation()
  const courses = useCourses()
  const book = useCrmMutation(crm.bookDemo)
  const [courseId, setCourseId] = useState(lead.courseId ?? '')
  const [batchId, setBatchId] = useState('')
  const [date, setDate] = useState(istToday())
  const [studentName, setStudentName] = useState(lead.studentName ?? displayName(lead.contact))
  const options =
    courses.data
      ?.find((c) => c.id === courseId)
      ?.batches.filter((b) => b.active && b.demoAllowed) ?? []
  useEffect(() => {
    if (!options.some((b) => b.id === batchId)) setBatchId(options[0]?.id ?? '')
  }, [options, batchId])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    book.mutate(
      { leadId: lead.id, batchId, date, studentName },
      {
        onSuccess: () => {
          toast({ title: t('leads.demoBooked'), tone: 'success' })
          onDone()
        },
        onError: (err) => toast({ title: errorText(err, t('common.failed')), tone: 'danger' }),
      },
    )
  }
  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-card border border-rule bg-paper p-4"
    >
      <Select
        label={t('leads.course')}
        value={courseId}
        onChange={(e) => setCourseId(e.target.value)}
        required
      >
        <option value="">—</option>
        {courses.data
          ?.filter((c) => c.active)
          .map((c) => (
            <option key={c.id} value={c.id}>
              {c.shortName}
            </option>
          ))}
      </Select>
      <Select
        label={t('leads.batch')}
        value={batchId}
        onChange={(e) => setBatchId(e.target.value)}
        required
        disabled={!options.length}
      >
        {options.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name} · {b.startTime.slice(0, 5)}
          </option>
        ))}
      </Select>
      <Input
        label={t('leads.demoDate')}
        type="date"
        min={istToday()}
        value={date}
        onChange={(e) => setDate(e.target.value)}
        required
      />
      <Input
        label={t('leads.studentName')}
        value={studentName}
        onChange={(e) => setStudentName(e.target.value)}
        required
        maxLength={80}
      />
      <Button
        type="submit"
        size="md"
        className="self-start"
        loading={book.isPending}
        disabled={!batchId}
      >
        {t('leads.bookDemo')}
      </Button>
    </form>
  )
}

function AdmitForm({ lead, onDone }: { lead: LeadDetail; onDone(): void }) {
  const { t } = useTranslation()
  const courses = useCourses()
  const admit = useCrmMutation(crm.admit)
  const [name, setName] = useState(lead.studentName ?? displayName(lead.contact))
  const [courseId, setCourseId] = useState(lead.courseId ?? '')
  const [batchId, setBatchId] = useState(lead.batchId ?? '')
  const [date, setDate] = useState(istToday())
  const batches =
    courses.data?.find((c) => c.id === courseId)?.batches.filter((b) => b.active) ?? []
  const submit = (e: FormEvent) => {
    e.preventDefault()
    admit.mutate(
      { id: lead.id, name, courseId, batchId: batchId || null, admissionDate: date },
      {
        onSuccess: () => {
          toast({ title: t('leads.admitted'), tone: 'success' })
          onDone()
        },
        onError: (err) => toast({ title: errorText(err, t('common.failed')), tone: 'danger' }),
      },
    )
  }
  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-card border border-rule bg-paper p-4"
    >
      <Input
        label={t('leads.studentName')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        maxLength={80}
      />
      <Select
        label={t('leads.course')}
        value={courseId}
        onChange={(e) => setCourseId(e.target.value)}
        required
      >
        <option value="">—</option>
        {courses.data?.map((c) => (
          <option key={c.id} value={c.id}>
            {c.shortName}
          </option>
        ))}
      </Select>
      <Select label={t('leads.batch')} value={batchId} onChange={(e) => setBatchId(e.target.value)}>
        <option value="">{t('leads.noBatch')}</option>
        {batches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </Select>
      <Input
        label={t('leads.admissionDate')}
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        required
      />
      <Button type="submit" size="md" className="self-start" loading={admit.isPending}>
        {t('leads.admit')}
      </Button>
    </form>
  )
}

function Demos({ lead }: { lead: LeadDetail }) {
  const { t } = useTranslation()
  const lang = usePreferences((s) => s.language)
  return (
    <section>
      <h3 className="text-h3 text-ink">{t('leads.demos')}</h3>
      <ul className="mt-2 flex flex-col gap-2">
        {lead.demos.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center gap-2 text-body text-ink">
            <span className="tabular">
              {dayLabel(d.startsAt, lang)}, {clock(d.startsAt, lang)}
            </span>
            <StatusPill
              tone={
                d.status === 'attended'
                  ? 'success'
                  : d.status === 'no_show' || d.status === 'cancelled'
                    ? 'neutral'
                    : 'attention'
              }
            >
              {t(`demo.status.${d.status}`)}
            </StatusPill>
            {d.bookedBy === 'bot' && <StatusPill tone="bot">{t('demo.bookedByBot')}</StatusPill>}
          </li>
        ))}
      </ul>
    </section>
  )
}

function Timeline({ lead }: { lead: LeadDetail }) {
  const { t } = useTranslation()
  const lang = usePreferences((s) => s.language)
  return (
    <section>
      <h3 className="text-h3 text-ink">{t('leads.timeline')}</h3>
      <ol className="mt-3 flex flex-col gap-3 border-l-2 border-rule pl-4">
        {lead.events.map((e) => (
          <li key={e.id} className="text-body text-ink">
            <p>
              {e.type === 'stage' && e.fromStage && e.toStage
                ? t('leads.event.stage', {
                    from: t(`stages.${e.fromStage}`),
                    to: t(`stages.${e.toStage}`),
                  })
                : t(`leads.event.${e.type}`, { defaultValue: e.type })}
              {e.note && (
                <span className="text-ink-muted">
                  :{' '}
                  {e.type === 'stage' && e.toStage === 'lost'
                    ? t(`lostReasons.${e.note}`, { defaultValue: e.note })
                    : e.note}
                </span>
              )}
            </p>
            <p className="text-small text-ink-muted">
              {e.actor === 'user'
                ? t('leads.by.user', { name: e.actorName ?? '' })
                : t(`leads.by.${e.actor}`)}{' '}
              · {dayLabel(e.createdAt, lang)}, {clock(e.createdAt, lang)}
            </p>
          </li>
        ))}
      </ol>
    </section>
  )
}
