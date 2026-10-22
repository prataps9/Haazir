import {
  FilePdfIcon,
  GraduationCapIcon,
  NotePencilIcon,
  PlusIcon,
  TrashIcon,
} from '@phosphor-icons/react'
import { parseRupeesToPaise } from '@haazir/shared'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Page } from '@/app/Page'
import { Button, IconButton } from '@/components/Button'
import { EmptyState } from '@/components/EmptyState'
import { Input } from '@/components/Input'
import { SegmentedControl } from '@/components/SegmentedControl'
import { Sheet } from '@/components/Sheet'
import { ListSkeleton } from '@/components/Skeleton'
import { StatusPill } from '@/components/StatusPill'
import { Switch } from '@/components/Switch'
import { Textarea } from '@/components/Textarea'
import { cn } from '@/lib/cn'
import { crm, useCourses, useCrmMutation, type Batch, type Course } from '@/lib/crm'
import { errorText } from '@/lib/errors'
import { formatPaise } from '@/lib/format'
import { useMe } from '@/lib/session'
import { toast } from '@/lib/toast'

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
const rupeesText = (paise: number) => (paise / 100).toString()

/**
 * Courses & batches (spec §16.6): the only place the bot's fees and timings
 * come from. Ruled rows; editing opens a sheet. Agents can look, not change.
 */
export default function CoursesPage() {
  const { t } = useTranslation()
  const { org } = useMe()
  const canEdit = org?.role === 'owner' || org?.role === 'admin'
  const courses = useCourses()
  const [editing, setEditing] = useState<Course | 'new' | null>(null)
  const [batch, setBatch] = useState<{ course: Course; batch: Batch | null } | null>(null)

  return (
    <Page title={t('courses.title')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body text-ink-muted">{t('courses.botNote')}</p>
        {canEdit && (
          <Button size="md" onClick={() => setEditing('new')}>
            <PlusIcon weight="bold" aria-hidden />
            {t('courses.add')}
          </Button>
        )}
      </div>
      <div className="mt-4 flex flex-col gap-4">
        {courses.isError ? (
          <p className="text-body text-danger-600">{t('common.loadError')}</p>
        ) : courses.isPending ? (
          <ListSkeleton rows={4} />
        ) : !courses.data.length ? (
          <EmptyState
            icon={GraduationCapIcon}
            title={t('courses.emptyTitle')}
            body={t('courses.emptyBody')}
            action={
              canEdit && <Button onClick={() => setEditing('new')}>{t('courses.add')}</Button>
            }
          />
        ) : (
          courses.data.map((c) => (
            <section key={c.id} className="rounded-card border border-rule bg-surface">
              <div className="flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <h2 className="text-h3 text-ink">{c.name}</h2>
                  <p className="text-small text-ink-muted">
                    {[
                      c.shortName !== c.name && c.shortName,
                      c.durationText,
                      t(`courses.modes.${c.mode}`),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <span className="font-display text-h2 text-ink tabular">
                  {formatPaise(c.feeTotalPaise)}
                </span>
                {!c.active && <StatusPill tone="neutral">{t('courses.inactive')}</StatusPill>}
                {c.hasBrochure && (
                  <StatusPill tone="success" icon={FilePdfIcon}>
                    {t('courses.hasBrochure')}
                  </StatusPill>
                )}
                {canEdit && (
                  <IconButton label={t('courses.edit')} onClick={() => setEditing(c)}>
                    <NotePencilIcon />
                  </IconButton>
                )}
              </div>
              {c.installmentPlan.length > 1 && (
                <p className="border-t border-rule px-4 py-2 text-small text-ink-muted">
                  {c.installmentPlan
                    .map((s) => `${s.label} ${formatPaise(s.amountPaise)}`)
                    .join(' · ')}
                </p>
              )}
              <div className="border-t border-rule px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-body font-semibold text-ink">{t('courses.batches')}</h3>
                  {canEdit && (
                    <Button
                      variant="ghost"
                      size="md"
                      onClick={() => setBatch({ course: c, batch: null })}
                    >
                      <PlusIcon aria-hidden />
                      {t('courses.addBatch')}
                    </Button>
                  )}
                </div>
                {!c.batches.length ? (
                  <p className="text-small text-ink-muted">{t('courses.noBatches')}</p>
                ) : (
                  <ul className="mt-1 divide-y divide-rule">
                    {c.batches.map((b) => (
                      <BatchRow
                        key={b.id}
                        batch={b}
                        onEdit={canEdit ? () => setBatch({ course: c, batch: b }) : undefined}
                      />
                    ))}
                  </ul>
                )}
              </div>
            </section>
          ))
        )}
      </div>
      <CourseSheet course={editing} onClose={() => setEditing(null)} />
      <BatchSheet target={batch} onClose={() => setBatch(null)} />
    </Page>
  )
}

function BatchRow({ batch, onEdit }: { batch: Batch; onEdit?(): void }) {
  const { t } = useTranslation()
  const pct = Math.min(100, Math.round((batch.seatsFilled / Math.max(1, batch.seatsTotal)) * 100))
  return (
    <li className="flex flex-wrap items-center gap-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-body text-ink">
          {batch.name}{' '}
          <span className="text-ink-muted tabular">
            {batch.startTime.slice(0, 5)}–{batch.endTime.slice(0, 5)}
          </span>
        </p>
        <p className="text-small text-ink-muted">
          {batch.days.map((d) => t(`courses.weekdays.${d}`)).join(', ')}
        </p>
      </div>
      <div className="w-36">
        <div className="h-2 overflow-hidden rounded-full bg-ink/8" aria-hidden>
          <div
            className={cn('h-full rounded-full', pct >= 90 ? 'bg-danger-600' : 'bg-pottery-600')}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-1 text-small text-ink-muted tabular">
          {t('courses.seatsOf', { filled: batch.seatsFilled, total: batch.seatsTotal })}
        </p>
      </div>
      {batch.demoAllowed && <StatusPill tone="bot">{t('courses.demoAllowed')}</StatusPill>}
      {onEdit && (
        <IconButton label={t('courses.editBatch')} onClick={onEdit}>
          <NotePencilIcon />
        </IconButton>
      )}
    </li>
  )
}

interface StepDraft {
  label: string
  amount: string
  afterDays: string
}

function CourseSheet({ course, onClose }: { course: Course | 'new' | null; onClose(): void }) {
  const { t } = useTranslation()
  return (
    <Sheet
      open={!!course}
      onOpenChange={(o) => !o && onClose()}
      title={course === 'new' ? t('courses.add') : t('courses.edit')}
      closeLabel={t('common.close')}
    >
      {course && (
        <CourseForm
          key={course === 'new' ? 'new' : course.id}
          course={course === 'new' ? null : course}
          onDone={onClose}
        />
      )}
    </Sheet>
  )
}

export function CourseForm({
  course,
  draft,
  onDone,
}: {
  course: Course | null
  /** Prefill from the brochure reading (onboarding). */
  draft?: Partial<
    Pick<
      Course,
      | 'name'
      | 'shortName'
      | 'description'
      | 'durationText'
      | 'feeTotalPaise'
      | 'installmentPlan'
      | 'mode'
    >
  >
  onDone(): void
}) {
  const { t } = useTranslation()
  const save = useCrmMutation(crm.saveCourse)
  const upload = useCrmMutation(crm.uploadBrochure)
  const start = course ?? draft ?? {}
  const [name, setName] = useState(start.name ?? '')
  const [shortName, setShortName] = useState(start.shortName ?? '')
  const [description, setDescription] = useState(start.description ?? '')
  const [duration, setDuration] = useState(start.durationText ?? '')
  const [mode, setMode] = useState<Course['mode']>(start.mode ?? 'offline')
  const [fee, setFee] = useState(start.feeTotalPaise != null ? rupeesText(start.feeTotalPaise) : '')
  const [active, setActive] = useState(course?.active ?? true)
  const [steps, setSteps] = useState<StepDraft[]>(
    (start.installmentPlan ?? []).map((s) => ({
      label: s.label,
      amount: rupeesText(s.amountPaise),
      afterDays: String(s.dueOffsetDays),
    })),
  )
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string>()

  const feePaise = parseRupeesToPaise(fee) ?? 0
  const plan = steps.map((s) => ({
    label: s.label.trim(),
    amountPaise: parseRupeesToPaise(s.amount) ?? 0,
    dueOffsetDays: Math.max(0, Number(s.afterDays) || 0),
  }))
  const total = plan.reduce((sum, s) => sum + s.amountPaise, 0)
  const mismatch = steps.length > 0 && total !== feePaise

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setError(undefined)
    save.mutate(
      {
        id: course?.id,
        name,
        shortName,
        description: description || null,
        durationText: duration || null,
        mode,
        feeTotalPaise: feePaise,
        installmentPlan: plan,
        active,
      },
      {
        onSuccess: async (saved) => {
          if (file) {
            try {
              await upload.mutateAsync({ courseId: saved.id, file })
            } catch (err) {
              return setError(errorText(err, t('common.failed')))
            }
          }
          toast({ title: t('courses.saved'), tone: 'success' })
          onDone()
        },
        onError: (err) => setError(errorText(err, t('common.failed'))),
      },
    )
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 px-5 pt-1 pb-8">
      <p className="rounded-card bg-marigold-50 px-4 py-3 text-body text-ink">
        {t('courses.botNote')}
      </p>
      <Input
        label={t('courses.name')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        minLength={2}
        maxLength={120}
      />
      <Input
        label={t('courses.shortName')}
        hint={`${t('courses.shortNameHint')} (${[...shortName].length}/24)`}
        error={[...shortName].length > 24 ? t('courses.shortNameHint') : undefined}
        value={shortName}
        onChange={(e) => setShortName(e.target.value)}
        required
      />
      <Input
        label={t('courses.fee')}
        inputMode="decimal"
        value={fee}
        onChange={(e) => setFee(e.target.value)}
        required
        placeholder="4,500"
      />
      <Input
        label={t('courses.duration')}
        hint={t('courses.durationHint')}
        value={duration}
        onChange={(e) => setDuration(e.target.value)}
        maxLength={40}
      />
      <SegmentedControl<Course['mode']>
        legend={t('courses.mode')}
        value={mode}
        onChange={setMode}
        options={(['offline', 'online', 'hybrid'] as const).map((m) => ({
          value: m,
          label: t(`courses.modes.${m}`),
        }))}
      />
      <Textarea
        label={t('courses.description')}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={3}
        maxLength={1000}
      />

      <fieldset className="flex flex-col gap-3">
        <legend className="text-small font-semibold text-ink">{t('courses.installments')}</legend>
        <p className="text-small text-ink-muted">{t('courses.installmentsHint')}</p>
        {steps.map((s, i) => (
          <div
            key={i}
            className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.8fr)_auto] items-end gap-2"
          >
            <Input
              label={t('courses.label')}
              value={s.label}
              onChange={(e) =>
                setSteps(steps.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
              }
              required
            />
            <Input
              label={t('courses.amount')}
              inputMode="decimal"
              value={s.amount}
              onChange={(e) =>
                setSteps(steps.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))
              }
              required
            />
            <Input
              label={t('courses.afterDays')}
              inputMode="numeric"
              value={s.afterDays}
              onChange={(e) =>
                setSteps(steps.map((x, j) => (j === i ? { ...x, afterDays: e.target.value } : x)))
              }
            />
            <IconButton
              label={t('courses.removeInstallment')}
              onClick={() => setSteps(steps.filter((_, j) => j !== i))}
              className="mb-0.5 size-12"
            >
              <TrashIcon />
            </IconButton>
          </div>
        ))}
        <Button
          variant="ghost"
          size="md"
          className="self-start"
          onClick={() =>
            setSteps([...steps, { label: '', amount: '', afterDays: steps.length ? '30' : '0' }])
          }
        >
          <PlusIcon aria-hidden />
          {t('courses.addInstallment')}
        </Button>
        {steps.length > 0 && (
          <StatusPill tone={mismatch ? 'danger' : 'success'} className="self-start">
            {mismatch
              ? t('courses.totalMismatch', {
                  total: formatPaise(total),
                  fee: formatPaise(feePaise),
                })
              : t('courses.totalOk')}
          </StatusPill>
        )}
      </fieldset>

      <Input
        label={t('courses.brochure')}
        hint={
          course?.hasBrochure
            ? `${t('courses.hasBrochure')}. ${t('courses.brochureHint')}`
            : t('courses.brochureHint')
        }
        type="file"
        accept="application/pdf"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="[&_input]:py-2.5"
      />
      <Switch label={t('courses.active')} checked={active} onChange={setActive} />
      {error && (
        <p role="alert" className="text-body text-danger-600">
          {error}
        </p>
      )}
      <Button
        type="submit"
        block
        loading={save.isPending || upload.isPending}
        disabled={mismatch || [...shortName].length > 24}
      >
        {t('courses.save')}
      </Button>
    </form>
  )
}

function BatchSheet({
  target,
  onClose,
}: {
  target: { course: Course; batch: Batch | null } | null
  onClose(): void
}) {
  const { t } = useTranslation()
  return (
    <Sheet
      open={!!target}
      onOpenChange={(o) => !o && onClose()}
      title={target?.batch ? t('courses.editBatch') : t('courses.addBatch')}
      closeLabel={t('common.close')}
    >
      {target && (
        <BatchForm
          key={target.batch?.id ?? 'new'}
          course={target.course}
          batch={target.batch}
          onDone={onClose}
        />
      )}
    </Sheet>
  )
}

function BatchForm({
  course,
  batch,
  onDone,
}: {
  course: Course
  batch: Batch | null
  onDone(): void
}) {
  const { t } = useTranslation()
  const save = useCrmMutation(crm.saveBatch)
  const [name, setName] = useState(batch?.name ?? '')
  const [days, setDays] = useState<string[]>(
    batch?.days ?? ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
  )
  const [startTime, setStartTime] = useState(batch?.startTime.slice(0, 5) ?? '08:00')
  const [endTime, setEndTime] = useState(batch?.endTime.slice(0, 5) ?? '09:30')
  const [startDate, setStartDate] = useState(
    batch?.startDate ?? new Date().toISOString().slice(0, 10),
  )
  const [seatsTotal, setSeatsTotal] = useState(String(batch?.seatsTotal ?? 30))
  const [seatsFilled, setSeatsFilled] = useState(String(batch?.seatsFilled ?? 0))
  const [demoAllowed, setDemoAllowed] = useState(batch?.demoAllowed ?? true)
  const [active, setActive] = useState(batch?.active ?? true)
  const [error, setError] = useState<string>()

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setError(undefined)
    save.mutate(
      {
        id: batch?.id,
        courseId: course.id,
        name,
        days,
        startTime,
        endTime,
        startDate,
        seatsTotal: Number(seatsTotal),
        seatsFilled: Number(seatsFilled),
        demoAllowed,
        active,
      },
      {
        onSuccess: () => {
          toast({ title: t('courses.batchSaved'), tone: 'success' })
          onDone()
        },
        onError: (err) => setError(errorText(err, t('common.failed'))),
      },
    )
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 px-5 pt-1 pb-8">
      <p className="text-body text-ink-muted">{course.name}</p>
      <Input
        label={t('courses.batchName')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        maxLength={60}
        placeholder="Shaam"
      />
      <fieldset>
        <legend className="mb-1.5 text-small font-semibold text-ink">{t('courses.days')}</legend>
        <div className="flex flex-wrap gap-2">
          {DAYS.map((d) => {
            const on = days.includes(d)
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                onClick={() => setDays(on ? days.filter((x) => x !== d) : [...days, d])}
                className={cn(
                  'min-h-11 min-w-12 rounded-full border px-3 text-body transition-colors duration-150',
                  on
                    ? 'border-madder-700 bg-madder-50 font-semibold text-madder-700'
                    : 'border-rule bg-surface text-ink-muted',
                )}
              >
                {t(`courses.weekdays.${d}`)}
              </button>
            )
          })}
        </div>
      </fieldset>
      <div className="grid grid-cols-2 gap-3">
        <Input
          label={t('courses.from')}
          type="time"
          value={startTime}
          onChange={(e) => setStartTime(e.target.value)}
          required
        />
        <Input
          label={t('courses.to')}
          type="time"
          value={endTime}
          onChange={(e) => setEndTime(e.target.value)}
          required
        />
      </div>
      <Input
        label={t('courses.startDate')}
        type="date"
        value={startDate}
        onChange={(e) => setStartDate(e.target.value)}
        required
      />
      <div className="grid grid-cols-2 gap-3">
        <Input
          label={t('courses.seats')}
          inputMode="numeric"
          value={seatsTotal}
          onChange={(e) => setSeatsTotal(e.target.value)}
          required
        />
        <Input
          label={t('courses.seatsFilled')}
          inputMode="numeric"
          value={seatsFilled}
          onChange={(e) => setSeatsFilled(e.target.value)}
        />
      </div>
      <Switch label={t('courses.demoAllowed')} checked={demoAllowed} onChange={setDemoAllowed} />
      <Switch label={t('courses.active')} checked={active} onChange={setActive} />
      {error && (
        <p role="alert" className="text-body text-danger-600">
          {error}
        </p>
      )}
      <Button type="submit" block loading={save.isPending} disabled={!days.length}>
        {t('courses.saveBatch')}
      </Button>
    </form>
  )
}
