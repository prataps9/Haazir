import {
  CheckCircleIcon,
  CircleDashedIcon,
  FilePdfIcon,
  RocketLaunchIcon,
  WhatsappLogoIcon,
} from '@phosphor-icons/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { DEFAULT_TEMPLATES } from '@haazir/shared'
import { useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Page } from '@/app/Page'
import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { Input } from '@/components/Input'
import { SegmentedControl } from '@/components/SegmentedControl'
import { Skeleton } from '@/components/Skeleton'
import { StatusPill } from '@/components/StatusPill'
import { Switch } from '@/components/Switch'
import { ApiError, patch, post } from '@/lib/api'
import { cn } from '@/lib/cn'
import { crm, useCourses, useCrmMutation, useOrg, type Course, type Org } from '@/lib/crm'
import { errorText } from '@/lib/errors'
import { formatPaise } from '@/lib/format'
import { useMe } from '@/lib/session'
import { toast } from '@/lib/toast'
import { CourseForm } from '@/features/courses/CoursesPage'
import { Playground } from '@/features/knowledge/Playground'
import { useBotConfig } from '@/features/knowledge/queries'

const STEPS = [
  'business',
  'whatsapp',
  'brochure',
  'courses',
  'bot',
  'test',
  'templates',
  'live',
] as const
type Step = (typeof STEPS)[number]
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

type Draft = Partial<
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

/**
 * Onboarding (spec §16.2): a stepper that saves every step and resumes where
 * the owner left off. Nothing here goes live until the last step's switch.
 */
export default function OnboardingPage() {
  const { t } = useTranslation()
  const org = useOrg()
  const { org: membership } = useMe()
  const [index, setIndex] = useState<number | null>(null)
  const [drafts, setDrafts] = useState<Draft[]>([])
  const qc = useQueryClient()
  const progress = useMutation({
    mutationFn: (step: number) => crm.onboardingStep({ step }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['org'] }),
  })

  if (membership && membership.role === 'agent') {
    return (
      <Page title={t('onboarding.title')}>
        <p className="text-body text-ink-muted">{t('bot.readOnly')}</p>
      </Page>
    )
  }
  if (!org.data)
    return (
      <Page title={t('onboarding.title')}>
        <Skeleton className="h-64" />
      </Page>
    )

  const current = index ?? Math.min(org.data.onboardingStep, STEPS.length - 1)
  const step = STEPS[current]!
  const go = (n: number) => {
    const next = Math.max(0, Math.min(STEPS.length - 1, n))
    if (next > org.data!.onboardingStep) progress.mutate(next)
    setIndex(next)
    window.scrollTo({ top: 0 })
  }
  const next = () => go(current + 1)

  return (
    <Page title={t('onboarding.title')}>
      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label={t('onboarding.title')}>
          <p className="text-small text-ink-muted lg:hidden">
            {t('onboarding.step', { n: current + 1, total: STEPS.length })}
          </p>
          <ol className="hidden flex-col gap-1 lg:flex">
            {STEPS.map((s, i) => (
              <li key={s}>
                <button
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-current={i === current ? 'step' : undefined}
                  className={cn(
                    'flex min-h-11 w-full items-center gap-2 rounded-control px-2 text-left text-body transition-colors duration-150',
                    i === current
                      ? 'bg-madder-50 font-semibold text-madder-700'
                      : 'text-ink-muted hover:text-ink',
                  )}
                >
                  {i < org.data!.onboardingStep ? (
                    <CheckCircleIcon
                      className="size-5 shrink-0 text-pottery-600"
                      weight="fill"
                      aria-hidden
                    />
                  ) : (
                    <CircleDashedIcon className="size-5 shrink-0" aria-hidden />
                  )}
                  {t(`onboarding.steps.${s}`)}
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <section className="flex max-w-2xl flex-col gap-4">
          <h2 className="text-h2 text-ink">{t(`onboarding.steps.${step}`)}</h2>
          <StepBody
            step={step}
            org={org.data}
            drafts={drafts}
            setDrafts={setDrafts}
            onNext={next}
          />
          <div className="flex flex-wrap gap-2 border-t border-rule pt-4">
            {current > 0 && (
              <Button variant="ghost" size="md" onClick={() => go(current - 1)}>
                {t('onboarding.back')}
              </Button>
            )}
            {step !== 'business' && step !== 'live' && (
              <Button variant="secondary" size="md" onClick={next}>
                {step === 'brochure' || step === 'whatsapp'
                  ? t('onboarding.skip')
                  : t('onboarding.next')}
              </Button>
            )}
          </div>
        </section>
      </div>
    </Page>
  )
}

function StepBody(props: {
  step: Step
  org: Org
  drafts: Draft[]
  setDrafts(d: Draft[]): void
  onNext(): void
}) {
  switch (props.step) {
    case 'business':
      return <BusinessStep org={props.org} onNext={props.onNext} />
    case 'whatsapp':
      return <WhatsappStep org={props.org} />
    case 'brochure':
      return <BrochureStep onDrafts={(d) => props.setDrafts(d)} onNext={props.onNext} />
    case 'courses':
      return <CoursesStep drafts={props.drafts} setDrafts={props.setDrafts} />
    case 'bot':
      return <BotStep onNext={props.onNext} />
    case 'test':
      return <TestStep />
    case 'templates':
      return <TemplatesStep />
    case 'live':
      return <LiveStep org={props.org} />
  }
}

function BusinessStep({ org, onNext }: { org: Org; onNext(): void }) {
  const { t } = useTranslation()
  const save = useCrmMutation(crm.updateOrg)
  const [name, setName] = useState(org.name)
  const [city, setCity] = useState(org.city ?? '')
  const [address, setAddress] = useState(org.address ?? '')
  const [mapsUrl, setMapsUrl] = useState(org.mapsUrl ?? '')
  const [language, setLanguage] = useState(org.defaultLanguage)
  const [hours, setHours] = useState<Record<string, { open: string; close: string } | null>>(
    org.businessHours ??
      Object.fromEntries(
        DAYS.map((d) => [d, d === 'sun' ? null : { open: '08:00', close: '20:00' }]),
      ),
  )
  const [same, setSame] = useState(false)
  const setDay = (d: string, v: { open: string; close: string } | null) =>
    setHours(same ? Object.fromEntries(DAYS.map((x) => [x, v])) : { ...hours, [d]: v })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate(
      {
        name,
        city,
        address: address || null,
        mapsUrl: mapsUrl || null,
        defaultLanguage: language,
        businessHours: hours,
      },
      {
        onSuccess: () => onNext(),
        onError: (err) => toast({ title: errorText(err, t('common.failed')), tone: 'danger' }),
      },
    )
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Input
        label={t('onboarding.businessName')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        minLength={2}
      />
      <Input
        label={t('onboarding.city')}
        value={city}
        onChange={(e) => setCity(e.target.value)}
        required
        minLength={2}
      />
      <Input
        label={t('onboarding.address')}
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        maxLength={300}
      />
      <Input
        label={t('onboarding.mapsUrl')}
        type="url"
        value={mapsUrl}
        onChange={(e) => setMapsUrl(e.target.value)}
        placeholder="https://maps.app.goo.gl/…"
      />
      <SegmentedControl<Org['defaultLanguage']>
        legend={t('onboarding.language')}
        value={language}
        onChange={setLanguage}
        options={(['hi', 'hinglish', 'en'] as const).map((l) => ({
          value: l,
          label: t(`contact.languages.${l}`),
        }))}
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-small font-semibold text-ink">{t('onboarding.hours')}</legend>
        <Switch label={t('onboarding.sameEveryDay')} checked={same} onChange={setSame} />
        {DAYS.map((d) => {
          const h = hours[d] ?? null
          return (
            <div
              key={d}
              className="grid grid-cols-[3.5rem_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2"
            >
              <span className="text-body text-ink">{t(`courses.weekdays.${d}`)}</span>
              <input
                type="time"
                aria-label={`${t(`courses.weekdays.${d}`)} ${t('courses.from')}`}
                value={h?.open ?? ''}
                disabled={!h}
                onChange={(e) => setDay(d, { open: e.target.value, close: h?.close ?? '20:00' })}
                className="h-11 rounded-control border border-rule bg-surface px-2 text-body text-ink disabled:opacity-40"
              />
              <input
                type="time"
                aria-label={`${t(`courses.weekdays.${d}`)} ${t('courses.to')}`}
                value={h?.close ?? ''}
                disabled={!h}
                onChange={(e) => setDay(d, { open: h?.open ?? '08:00', close: e.target.value })}
                className="h-11 rounded-control border border-rule bg-surface px-2 text-body text-ink disabled:opacity-40"
              />
              <label className="flex min-h-11 items-center gap-1.5 text-small text-ink-muted">
                <input
                  type="checkbox"
                  checked={!h}
                  onChange={(e) =>
                    setDay(d, e.target.checked ? null : { open: '08:00', close: '20:00' })
                  }
                />
                {t('onboarding.closed')}
              </label>
            </div>
          )
        })}
      </fieldset>
      <Button type="submit" loading={save.isPending} className="self-start">
        {t('onboarding.next')}
      </Button>
    </form>
  )
}

function WhatsappStep({ org }: { org: Org }) {
  const { t } = useTranslation()
  const wa = org.whatsapp
  return (
    <Card>
      {wa && wa.status === 'connected' ? (
        <div className="flex flex-col gap-2">
          <StatusPill tone="success" icon={WhatsappLogoIcon} className="self-start">
            {t('onboarding.whatsappConnected', {
              phone: wa.displayPhone ?? '',
              name: wa.verifiedName ?? '',
            })}
          </StatusPill>
          {wa.qualityRating && (
            <p className="text-small text-ink-muted">
              {t('onboarding.quality', { rating: wa.qualityRating })}
            </p>
          )}
        </div>
      ) : (
        <p className="text-body text-ink-muted">{t('onboarding.whatsappPending')}</p>
      )}
    </Card>
  )
}

function BrochureStep({ onDrafts, onNext }: { onDrafts(d: Draft[]): void; onNext(): void }) {
  const { t } = useTranslation()
  const [file, setFile] = useState<File | null>(null)
  const [note, setNote] = useState<string>()
  const run = useMutation({
    mutationFn: async (pdf: File) => {
      const form = new FormData()
      form.set('file', pdf)
      form.set('title', pdf.name)
      const source = await post<{ id: string }>('/api/v1/knowledge/sources', form)
      try {
        return await post<{ draft: { courses: Draft[] } }>('/api/v1/knowledge/extract-brochure', {
          sourceId: source.id,
        })
      } catch (err) {
        if (err instanceof ApiError && err.code === 'UNAVAILABLE') return null
        throw err
      }
    },
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!file) return
    run.mutate(file, {
      onSuccess: (res) => {
        if (!res) return setNote(t('onboarding.extractUnavailable'))
        onDrafts(res.draft.courses)
        setNote(t('onboarding.extracted', { count: res.draft.courses.length }))
      },
      onError: (err) => toast({ title: errorText(err, t('common.failed')), tone: 'danger' }),
    })
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Input
        label={t('onboarding.brochureUpload')}
        type="file"
        accept="application/pdf"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="[&_input]:py-2.5"
      />
      <p className="text-small text-ink-muted">{t('onboarding.brochureOr')}</p>
      {note ? (
        <div className="flex flex-col gap-3">
          <StatusPill tone="success" icon={FilePdfIcon} className="self-start">
            {note}
          </StatusPill>
          <Button className="self-start" onClick={onNext}>
            {t('onboarding.next')}
          </Button>
        </div>
      ) : (
        <Button type="submit" className="self-start" loading={run.isPending} disabled={!file}>
          {run.isPending ? t('onboarding.extracting') : t('onboarding.brochureUpload')}
        </Button>
      )}
    </form>
  )
}

function CoursesStep({ drafts, setDrafts }: { drafts: Draft[]; setDrafts(d: Draft[]): void }) {
  const { t } = useTranslation()
  const courses = useCourses()
  const [adding, setAdding] = useState(false)
  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-card bg-marigold-50 px-4 py-3 text-body text-ink">
        {t('onboarding.draftNote')}
      </p>
      {courses.data?.map((c) => (
        <div
          key={c.id}
          className="flex items-center justify-between gap-3 rounded-card border border-rule bg-surface p-4"
        >
          <span className="flex items-center gap-2 text-body font-semibold text-ink">
            <CheckCircleIcon className="size-5 text-pottery-600" weight="fill" aria-hidden />
            {c.shortName}
          </span>
          <span className="text-body text-ink tabular">{formatPaise(c.feeTotalPaise)}</span>
        </div>
      ))}
      {drafts.map((d, i) => (
        <Section key={`${d.name}-${i}`} title={t('onboarding.draftTitle')}>
          <CourseForm
            course={null}
            draft={d}
            onDone={() => setDrafts(drafts.filter((_, j) => j !== i))}
          />
        </Section>
      ))}
      {adding ? (
        <Section title={t('courses.add')}>
          <CourseForm course={null} onDone={() => setAdding(false)} />
        </Section>
      ) : (
        <Button
          variant="secondary"
          size="md"
          className="self-start"
          onClick={() => setAdding(true)}
        >
          {t('courses.add')}
        </Button>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-card border border-rule bg-surface">
      <h3 className="px-5 pt-4 text-h3 text-ink">{title}</h3>
      {children}
    </section>
  )
}

function BotStep({ onNext }: { onNext(): void }) {
  const { org } = useMe()
  const bot = useBotConfig(org?.id)
  const qc = useQueryClient()
  const save = useMutation({
    mutationFn: (body: { personaName: string; tone: 'warm' | 'formal' }) =>
      patch('/api/v1/bot', body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['bot'] }),
  })
  if (!bot.data) return <Skeleton className="h-40" />
  return (
    <BotForm
      initial={bot.data}
      saving={save.isPending}
      onSave={(b) => save.mutate(b, { onSuccess: onNext })}
    />
  )
}

function BotForm({
  initial,
  saving,
  onSave,
}: {
  initial: { personaName: string; tone: 'warm' | 'formal' }
  saving: boolean
  onSave(b: { personaName: string; tone: 'warm' | 'formal' }): void
}) {
  const { t } = useTranslation()
  const [personaName, setPersonaName] = useState(initial.personaName)
  const [tone, setTone] = useState(initial.tone)
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSave({ personaName, tone })
      }}
      className="flex flex-col gap-4"
    >
      <Input
        label={t('bot.persona')}
        value={personaName}
        onChange={(e) => setPersonaName(e.target.value)}
        required
        maxLength={40}
      />
      <SegmentedControl<'warm' | 'formal'>
        legend={t('bot.tone')}
        value={tone}
        onChange={setTone}
        options={[
          { value: 'warm', label: t('bot.toneWarm') },
          { value: 'formal', label: t('bot.toneFormal') },
        ]}
      />
      <Button type="submit" className="self-start" loading={saving}>
        {t('onboarding.next')}
      </Button>
    </form>
  )
}

function TestStep() {
  const { t } = useTranslation()
  const { org } = useMe()
  const bot = useBotConfig(org?.id)
  return (
    <Playground
      endpoint="bot"
      aiConfigured={bot.data?.aiConfigured ?? true}
      suggestions={t('knowledge.suggestions', { returnObjects: true }) as string[]}
    />
  )
}

function TemplatesStep() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-3">
      <p className="text-body text-ink-muted">{t('onboarding.templatesBody')}</p>
      <ul className="divide-y divide-rule rounded-card border border-rule bg-surface">
        {DEFAULT_TEMPLATES.map((tpl) => (
          <li key={tpl.purpose} className="flex flex-col gap-1 p-4">
            <span className="flex items-center justify-between gap-2">
              <code className="text-small text-ink">{tpl.purpose}</code>
              <StatusPill tone="attention">{t('onboarding.pending')}</StatusPill>
            </span>
            <span className="text-small text-ink-muted">{tpl.body.hinglish}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function LiveStep({ org }: { org: Org }) {
  const { t } = useTranslation()
  const courses = useCourses()
  const qc = useQueryClient()
  const live = useMutation({
    mutationFn: async () => {
      await patch('/api/v1/bot', { enabled: true })
      return crm.onboardingStep({ step: STEPS.length, done: true })
    },
    onSuccess: () => {
      for (const k of ['org', 'bot']) void qc.invalidateQueries({ queryKey: [k] })
    },
    onError: (err) => toast({ title: errorText(err, t('common.failed')), tone: 'danger' }),
  })
  const checks: [string, boolean, boolean?][] = [
    [t('onboarding.checkWhatsapp'), org.whatsapp?.status === 'connected'],
    [t('onboarding.checkCourse'), !!courses.data?.some((c) => c.active && c.feeTotalPaise > 0)],
    [t('onboarding.checkTemplates'), false, true],
    [t('onboarding.checkStaff'), false, true],
  ]
  if (org.status === 'active') {
    return (
      <Card title={t('onboarding.liveTitle')} description={t('onboarding.liveBody')}>
        <RocketLaunchIcon className="size-10 text-pottery-600" weight="duotone" aria-hidden />
      </Card>
    )
  }
  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-h3 text-ink">{t('onboarding.checklist')}</h3>
      <ul className="flex flex-col gap-2">
        {checks.map(([label, ok, optional]) => (
          <li key={label} className="flex items-center gap-2 text-body text-ink">
            {ok ? (
              <StatusPill tone="success">{label}</StatusPill>
            ) : (
              <StatusPill tone={optional ? 'neutral' : 'attention'}>{label}</StatusPill>
            )}
          </li>
        ))}
      </ul>
      <Button
        className="self-start"
        loading={live.isPending}
        disabled={!checks[1]![1]}
        onClick={() => live.mutate()}
      >
        <RocketLaunchIcon aria-hidden />
        {t('onboarding.goLive')}
      </Button>
    </div>
  )
}
