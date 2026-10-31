import {
  ArrowLeftIcon,
  CardsIcon,
  CheckIcon,
  UsersThreeIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react'
import {
  CAMPAIGN_VARIABLE_SOURCES,
  fillTemplate,
  LEAD_STAGES,
  type CampaignAudience,
  type CampaignVariable,
  type CampaignVariableSource,
} from '@haazir/shared'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router'
import { Page } from '@/app/Page'
import { Button } from '@/components/Button'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { Input } from '@/components/Input'
import { SegmentedControl } from '@/components/SegmentedControl'
import { Select } from '@/components/Select'
import { Skeleton } from '@/components/Skeleton'
import { StatusPill } from '@/components/StatusPill'
import { cn } from '@/lib/cn'
import { useCourses } from '@/lib/crm'
import { formatCount, formatPaise } from '@/lib/format'
import {
  growth,
  useAudienceCount,
  useCampaign,
  useEstimate,
  useGrowthMutation,
  usePreview,
  useTemplates,
  type CampaignView,
} from '@/lib/growth'
import { usePreferences } from '@/lib/preferences'
import { toast } from '@/lib/toast'
import { growthError, languageLabel, rupeesPerMessage } from '../templates/templateUi'
import { WhatsAppPreview } from '../templates/WhatsAppPreview'
import { CAMPAIGN_TONE, fromIstLocalInput, istLocalInput, KNOWN_FAILURES } from './campaignUi'

/** One campaign: the builder while it's a draft, its results once it's on its way. */
export default function CampaignPage() {
  const { t } = useTranslation()
  const { id } = useParams()
  const campaign = useCampaign(id)
  const title = campaign.data?.name ?? t('campaigns.title')
  return (
    <Page title={title}>
      <Link
        to="/campaigns"
        className="-mt-3 mb-4 inline-flex min-h-11 items-center gap-1.5 text-body text-ink-muted hover:text-ink"
      >
        <ArrowLeftIcon aria-hidden />
        {t('campaigns.back')}
      </Link>
      {campaign.isError ? (
        <p className="text-body text-danger-600">{t('common.loadError')}</p>
      ) : campaign.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : campaign.data.status === 'draft' ? (
        <Builder key={campaign.data.id} campaign={campaign.data} />
      ) : (
        <Results campaign={campaign.data} />
      )}
    </Page>
  )
}

/** Sections, not routes (spec §16.8): template, audience, blanks, review. */
function Builder({ campaign: c }: { campaign: CampaignView }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const templates = useTemplates()
  const courses = useCourses()
  const save = useGrowthMutation(growth.saveCampaign)
  const schedule = useGrowthMutation(growth.scheduleCampaign)
  const remove = useGrowthMutation(growth.deleteCampaign)

  const [name, setName] = useState(c.name)
  const [templateId, setTemplateId] = useState(c.template?.id ?? null)
  const [audience, setAudience] = useState<CampaignAudience>(c.audience)
  const [tagText, setTagText] = useState((c.audience.tags ?? []).join(', '))
  const [map, setMap] = useState<CampaignVariable[]>(c.variableMap)
  const [when, setWhen] = useState<'now' | 'later'>('now')
  const [at, setAt] = useState(istLocalInput(new Date(Date.now() + 3_600_000)))
  const [confirming, setConfirming] = useState(false)

  // Campaign messages: announcements, the after-demo follow-up and the owner's
  // own. Reminders and receipts are for one person at a time, not a broadcast.
  const approved = (templates.data?.templates ?? []).filter(
    (x) => x.status === 'approved' && CAMPAIGN_PURPOSES.has(x.purpose),
  )
  const template = approved.find((x) => x.id === templateId)
  const n = template?.variableCount ?? 0
  const blanks = Array.from(
    { length: n },
    (_, i): CampaignVariable =>
      map[i] ??
      (template?.purpose === 'announcement'
        ? { source: 'custom', text: '' }
        : defaultBlank(template?.variables[i])),
  )

  // Saved as you go (debounced), so the estimate and preview read what you see.
  const blanksKey = JSON.stringify(blanks)
  const draft = useMemo(
    () => ({
      name: name.trim() || c.name,
      templateId,
      audience,
      variableMap: JSON.parse(blanksKey) as CampaignVariable[],
    }),
    [name, c.name, templateId, audience, blanksKey],
  )
  const draftKey = JSON.stringify(draft)
  const [savedKey, setSavedKey] = useState(draftKey)
  const saveDraft = save.mutate
  useEffect(() => {
    if (draftKey === savedKey) return
    const timer = setTimeout(
      () => saveDraft({ id: c.id, ...draft }, { onSuccess: () => setSavedKey(draftKey) }),
      500,
    )
    return () => clearTimeout(timer)
  }, [draft, draftKey, savedKey, saveDraft, c.id])

  const count = useAudienceCount(audience)
  const estimate = useEstimate(templateId ? c.id : undefined, savedKey)
  const preview = usePreview(templateId ? c.id : undefined, savedKey)
  const ready =
    !!template &&
    (count.data?.count ?? 0) > 0 &&
    blanks.every((b) => b.source !== 'custom' || b.text?.trim()) &&
    savedKey === draftKey

  const toggle = <K extends 'stages' | 'courseIds' | 'batchIds'>(key: K, value: string) => {
    const list = (audience[key] ?? []) as string[]
    const next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
    setAudience({ ...audience, [key]: next.length ? next : undefined })
  }
  const batches = (courses.data ?? []).flatMap((course) =>
    course.batches.map((b) => ({ ...b, course: course.shortName })),
  )

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex flex-col gap-6">
        <Section n={1} title={t('campaigns.sections.template')}>
          <Input
            label={t('campaigns.name')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
          />
          {templates.isPending ? (
            <Skeleton className="h-24 w-full" />
          ) : !approved.length ? (
            <EmptyState
              icon={CardsIcon}
              title={t('campaigns.noApprovedTitle')}
              body={t('campaigns.noApprovedBody')}
              action={
                <Button asChild size="md" variant="secondary">
                  <Link to="/templates">{t('campaigns.openTemplates')}</Link>
                </Button>
              }
            />
          ) : (
            <fieldset className="flex flex-col gap-2">
              <legend className="sr-only">{t('campaigns.pickTemplate')}</legend>
              {approved.map((x) => (
                <label
                  key={x.id}
                  className={cn(
                    'flex cursor-pointer gap-3 rounded-card border p-3',
                    x.id === templateId
                      ? 'border-madder-700 bg-madder-50'
                      : 'border-rule bg-surface',
                  )}
                >
                  <input
                    type="radio"
                    name="template"
                    className="mt-1.5 size-4 accent-madder-700"
                    checked={x.id === templateId}
                    onChange={() => {
                      setTemplateId(x.id)
                      setMap([])
                    }}
                  />
                  <span className="min-w-0">
                    <span className="block text-body font-semibold text-ink">
                      {x.purpose === 'custom' ? x.name : t(`templates.purposes.${x.purpose}`)}
                    </span>
                    <span className="block text-small text-ink-muted">
                      {languageLabel(t, x.name, x.language)} ·{' '}
                      {t(`templates.categories.${x.category}`)}
                    </span>
                    <span className="mt-1 line-clamp-2 block text-small text-ink">{x.body}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
        </Section>

        <Section n={2} title={t('campaigns.sections.audience')}>
          <Input
            label={t('campaigns.tags')}
            hint={t('campaigns.tagsHint')}
            value={tagText}
            onChange={(e) => {
              setTagText(e.target.value)
              const tags = e.target.value
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
              setAudience({ ...audience, tags: tags.length ? tags : undefined })
            }}
          />
          <Chips
            legend={t('campaigns.stages')}
            options={LEAD_STAGES.map((s) => ({ value: s, label: t(`stages.${s}`) }))}
            selected={audience.stages ?? []}
            onToggle={(v) => toggle('stages', v)}
          />
          <Chips
            legend={t('campaigns.courses')}
            options={(courses.data ?? []).map((x) => ({ value: x.id, label: x.shortName }))}
            selected={audience.courseIds ?? []}
            onToggle={(v) => toggle('courseIds', v)}
          />
          {batches.length > 0 && (
            <Chips
              legend={t('campaigns.batches')}
              options={batches.map((b) => ({ value: b.id, label: b.name }))}
              selected={audience.batchIds ?? []}
              onToggle={(v) => toggle('batchIds', v)}
            />
          )}
          <div className="flex items-start gap-3 rounded-card border border-rule bg-surface p-4">
            <UsersThreeIcon className="mt-0.5 size-6 shrink-0 text-madder-700" aria-hidden />
            <div>
              <p className="text-h3 text-ink" aria-live="polite">
                {count.data
                  ? t('campaigns.willReach', { count: count.data.count })
                  : t('common.loading')}
              </p>
              {count.data && count.data.optedOut + count.data.noConsent > 0 && (
                <p className="mt-1 text-small text-ink-muted">
                  {t('campaigns.leftOut', {
                    stop: count.data.optedOut,
                    noConsent: count.data.noConsent,
                  })}
                </p>
              )}
              <p className="mt-1 text-small text-ink-muted">{t('campaigns.consentNote')}</p>
            </div>
          </div>
        </Section>

        {template && n > 0 && (
          <Section n={3} title={t('campaigns.sections.blanks')}>
            {blanks.map((b, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[180px_minmax(0,1fr)] sm:items-end">
                <Select
                  label={t('campaigns.blankN', { n: i + 1 })}
                  value={b.source}
                  onChange={(e) =>
                    setMap(
                      blanks.map((x, j) =>
                        j === i ? { ...x, source: e.target.value as CampaignVariableSource } : x,
                      ),
                    )
                  }
                >
                  {CAMPAIGN_VARIABLE_SOURCES.map((s) => (
                    <option key={s} value={s}>
                      {t(`campaigns.sources.${s}`)}
                    </option>
                  ))}
                </Select>
                <Input
                  label={
                    b.source === 'custom' ? t('campaigns.blankText') : t('campaigns.blankFallback')
                  }
                  value={b.text ?? ''}
                  maxLength={200}
                  onChange={(e) =>
                    setMap(blanks.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))
                  }
                />
              </div>
            ))}
          </Section>
        )}

        <Section n={template && n > 0 ? 4 : 3} title={t('campaigns.sections.review')}>
          <SegmentedControl<'now' | 'later'>
            legend={t('campaigns.when')}
            value={when}
            onChange={setWhen}
            options={[
              { value: 'now', label: t('campaigns.now') },
              { value: 'later', label: t('campaigns.later') },
            ]}
          />
          {when === 'later' && (
            <Input
              type="datetime-local"
              label={t('campaigns.at')}
              value={at}
              min={istLocalInput(new Date())}
              onChange={(e) => setAt(e.target.value)}
            />
          )}
          <p className="text-small text-ink-muted">{t('campaigns.quietHours')}</p>
          <div className="flex flex-wrap gap-2">
            <Button disabled={!ready} onClick={() => setConfirming(true)}>
              {when === 'now' ? t('campaigns.sendNow') : t('campaigns.schedule')}
            </Button>
            <Button
              variant="ghost"
              loading={remove.isPending}
              onClick={() =>
                remove.mutate(c.id, {
                  onSuccess: () => navigate('/campaigns'),
                  onError: (err) => toast({ title: growthError(err, t), tone: 'danger' }),
                })
              }
            >
              {t('campaigns.deleteDraft')}
            </Button>
          </div>
        </Section>
      </div>

      <aside className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
        {template ? (
          <>
            <WhatsAppPreview
              header={template.header}
              body={preview.data?.text ?? template.body}
              footer={template.footer}
              buttons={template.buttons}
            />
            {preview.data?.contact && (
              <p className="-mt-2 text-small text-ink-muted">
                {t('campaigns.previewFor', {
                  name: preview.data.contact.name ?? preview.data.contact.waId,
                })}
              </p>
            )}
            <CostCard estimate={estimate.data} pending={estimate.isPending} />
          </>
        ) : (
          <p className="rounded-card border border-rule bg-surface p-4 text-small text-ink-muted">
            {t('campaigns.pickTemplateFirst')}
          </p>
        )}
      </aside>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('campaigns.confirmTitle', { count: count.data?.count ?? 0 })}
        body={
          estimate.data
            ? t('campaigns.confirmBody', {
                cost: formatPaise(estimate.data.costPaise + estimate.data.gstPaise),
              })
            : undefined
        }
        confirmLabel={when === 'now' ? t('campaigns.sendNow') : t('campaigns.schedule')}
        cancelLabel={t('common.cancel')}
        loading={schedule.isPending}
        onConfirm={() =>
          schedule.mutate(
            { id: c.id, at: when === 'later' ? fromIstLocalInput(at) : undefined },
            {
              onSuccess: () => {
                setConfirming(false)
                toast({ title: t('campaigns.scheduled') })
              },
              onError: (err) => {
                setConfirming(false)
                toast({ title: growthError(err, t), tone: 'danger' })
              },
            },
          )
        }
      />
    </div>
  )
}

const CAMPAIGN_PURPOSES = new Set(['announcement', 'followup', 'custom'])

/** A blank's sensible first choice, from what the template says it is. */
function defaultBlank(variable: string | undefined): CampaignVariable {
  if (variable === 'contact_name' || variable === 'name' || variable === 'student_name')
    return { source: 'contact_name', text: '' }
  if (variable === 'course') return { source: 'course', text: '' }
  if (variable === 'batch') return { source: 'batch', text: '' }
  return { source: 'custom', text: '' }
}

function Section({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 text-h2 text-ink">
        <span
          className="flex size-7 items-center justify-center rounded-full bg-ink/5 text-small font-semibold"
          aria-hidden
        >
          {n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  )
}

function Chips({
  legend,
  options,
  selected,
  onToggle,
}: {
  legend: string
  options: { value: string; label: string }[]
  selected: string[]
  onToggle(value: string): void
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-small font-semibold text-ink">{legend}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = selected.includes(o.value)
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(o.value)}
              className={cn(
                'flex min-h-9 items-center gap-1 rounded-full border px-3 text-small',
                on
                  ? 'border-madder-700 bg-madder-50 font-semibold text-madder-700'
                  : 'border-rule bg-surface text-ink hover:border-ink-muted/60',
              )}
            >
              {on && <CheckIcon className="size-4" weight="bold" aria-hidden />}
              {o.label}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}

/** Spec §16.8 CostEstimate: "~₹186 + GST, marketing category". */
function CostCard({
  estimate,
  pending,
}: {
  estimate: ReturnType<typeof useEstimate>['data']
  pending: boolean
}) {
  const { t } = useTranslation()
  if (pending || !estimate) return <Skeleton className="h-28 w-full" />
  return (
    <div className="rounded-card border border-rule bg-surface p-4">
      <p className="text-small text-ink-muted">{t('campaigns.estimate')}</p>
      <p className="mt-1 font-display text-h1 text-ink">
        ~{formatPaise(estimate.costPaise)}{' '}
        <span className="text-body text-ink-muted">
          + {formatPaise(estimate.gstPaise)} {t('campaigns.gst')}
        </span>
      </p>
      <p className="mt-1 text-small text-ink-muted">
        {t('campaigns.estimateDetail', {
          count: estimate.recipients,
          rate: rupeesPerMessage(estimate.rateCentipaise),
          category: t(`templates.categories.${estimate.category}`),
        })}
      </p>
      {estimate.tierLimit != null && estimate.recipients > estimate.tierLimit && (
        <p className="mt-2 flex items-start gap-1.5 text-small text-danger-600">
          <WarningCircleIcon className="mt-0.5 size-4 shrink-0" weight="bold" aria-hidden />
          {t('campaigns.overTier', { limit: formatCount(estimate.tierLimit) })}
        </p>
      )}
      <p className="mt-2 text-small text-ink-muted">{t('campaigns.billedByMeta')}</p>
    </div>
  )
}

/** Results (spec §16.8): sent, delivered, read, replied, failed with reasons, cost. */
function Results({ campaign: c }: { campaign: CampaignView }) {
  const { t } = useTranslation()
  const lang = usePreferences((s) => s.language)
  const cancel = useGrowthMutation(growth.cancelCampaign)
  const [stopping, setStopping] = useState(false)
  const r = c.results
  const tone = CAMPAIGN_TONE[c.status]
  const fmt = (iso: string) =>
    new Intl.DateTimeFormat(lang === 'hi' ? 'hi-IN' : 'en-IN', {
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'Asia/Kolkata',
    }).format(new Date(iso))

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-3">
          <StatusPill tone={tone.tone} icon={tone.icon}>
            {t(`campaigns.status.${c.status}`)}
          </StatusPill>
          <span className="text-small text-ink-muted">
            {c.status === 'scheduled' && c.scheduledAt
              ? t('campaigns.startsAt', { when: fmt(c.scheduledAt) })
              : c.startedAt
                ? t('campaigns.startedAt', { when: fmt(c.startedAt) })
                : null}
          </span>
          {(c.status === 'scheduled' || c.status === 'sending') && (
            <Button size="md" variant="secondary" onClick={() => setStopping(true)}>
              {t('campaigns.stop')}
            </Button>
          )}
        </div>

        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(
            [
              ['recipients', r?.recipients ?? c.estimatedRecipients ?? 0],
              ['sent', r?.sent ?? 0],
              ['delivered', r?.delivered ?? 0],
              ['read', r?.read ?? 0],
              ['replied', r?.replied ?? 0],
              ['failed', r?.failed ?? 0],
              ['skipped', r?.skipped ?? 0],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="rounded-card border border-rule bg-surface p-4">
              <dt className="text-small text-ink-muted">{t(`campaigns.results.${k}`)}</dt>
              <dd className="mt-1 font-display text-h1 text-ink">{formatCount(v)}</dd>
            </div>
          ))}
        </dl>

        {r && r.failures.length > 0 && (
          <section>
            <h2 className="text-h3 text-ink">{t('campaigns.whyFailed')}</h2>
            <ul className="mt-2 divide-y divide-rule rounded-card border border-rule bg-surface">
              {r.failures.map((f) => (
                <li key={f.code} className="flex items-start justify-between gap-3 p-3">
                  <span className="flex items-start gap-1.5 text-body text-ink">
                    <WarningCircleIcon
                      className="mt-1 size-4 shrink-0 text-danger-600"
                      weight="bold"
                      aria-hidden
                    />
                    {KNOWN_FAILURES.has(f.code)
                      ? t(`campaigns.failures.${f.code}`)
                      : (f.title ?? f.code)}
                  </span>
                  <span className="shrink-0 font-semibold text-ink tabular">
                    {formatCount(f.count)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <aside className="flex flex-col gap-4">
        <div className="rounded-card border border-rule bg-surface p-4">
          <p className="text-small text-ink-muted">{t('campaigns.cost')}</p>
          <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-body">
            <dt className="text-ink-muted">{t('campaigns.estimated')}</dt>
            <dd className="text-right text-ink tabular">
              {c.estimatedCostPaise == null ? '—' : formatPaise(c.estimatedCostPaise)}
            </dd>
            <dt className="text-ink-muted">{t('campaigns.actual')}</dt>
            <dd className="text-right font-semibold text-ink tabular">
              {formatPaise(r?.actualCostPaise ?? 0)}
            </dd>
            <dt className="text-ink-muted">{t('campaigns.gst')}</dt>
            <dd className="text-right text-ink tabular">{formatPaise(r?.actualGstPaise ?? 0)}</dd>
          </dl>
          <p className="mt-2 text-small text-ink-muted">{t('campaigns.actualNote')}</p>
        </div>
        {c.template && (
          <WhatsAppPreview
            header={c.template.header}
            // The words everyone got; per-person ones are named, e.g. [Their name].
            body={fillTemplate(
              c.template.body,
              c.variableMap.map((v) =>
                v.source === 'custom' ? (v.text ?? '') : `[${t(`campaigns.sources.${v.source}`)}]`,
              ),
            )}
            footer={c.template.footer}
            buttons={c.template.buttons}
          />
        )}
      </aside>

      <ConfirmDialog
        open={stopping}
        onOpenChange={setStopping}
        title={t('campaigns.stopTitle')}
        body={t('campaigns.stopBody')}
        confirmLabel={t('campaigns.stop')}
        cancelLabel={t('common.cancel')}
        danger
        loading={cancel.isPending}
        onConfirm={() =>
          cancel.mutate(c.id, {
            onSuccess: () => setStopping(false),
            onError: (err) => toast({ title: growthError(err, t), tone: 'danger' }),
          })
        }
      />
    </div>
  )
}
