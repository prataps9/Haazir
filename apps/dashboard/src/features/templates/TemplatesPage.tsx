import {
  ArrowsClockwiseIcon,
  CardsIcon,
  PaperPlaneTiltIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react'
import {
  componentsOf,
  fillTemplate,
  partsOf,
  sampleValue,
  templateProblems,
  templateSlug,
  variableCount,
  type TemplateButton,
  type TemplateStatus,
} from '@haazir/shared'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Page } from '@/app/Page'
import { Button, IconButton } from '@/components/Button'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { Input } from '@/components/Input'
import { SegmentedControl } from '@/components/SegmentedControl'
import { Sheet } from '@/components/Sheet'
import { ListSkeleton } from '@/components/Skeleton'
import { StatusPill } from '@/components/StatusPill'
import { Tabs } from '@/components/Tabs'
import { Textarea } from '@/components/Textarea'
import { growth, useGrowthMutation, useTemplates, type TemplateView } from '@/lib/growth'
import { toast } from '@/lib/toast'
import { categoryRate, growthError, languageLabel, TEMPLATE_TONE } from './templateUi'
import { WhatsAppPreview } from './WhatsAppPreview'

type Tab = 'all' | TemplateStatus
const TABS: Tab[] = ['all', 'approved', 'pending', 'draft', 'rejected']

/**
 * Templates (spec §16.9): the messages WhatsApp lets a business start a chat
 * with. Status pills, an editor for drafts with a live preview, "Meta ko
 * bhejein" one at a time or all at once, and a sync with Meta.
 */
export default function TemplatesPage() {
  const { t } = useTranslation()
  const templates = useTemplates()
  const [tab, setTab] = useState<Tab>('all')
  const [editing, setEditing] = useState<TemplateView | 'new' | null>(null)
  const [deleting, setDeleting] = useState<TemplateView | null>(null)
  const [submitAll, setSubmitAll] = useState(false)
  const sync = useGrowthMutation(growth.syncTemplates)
  const all = useGrowthMutation(growth.submitAll)
  const submit = useGrowthMutation(growth.submitTemplate)
  const remove = useGrowthMutation(growth.deleteTemplate)

  const list = templates.data?.templates ?? []
  const count = (s: Tab) => (s === 'all' ? list.length : list.filter((x) => x.status === s).length)
  const shown = tab === 'all' ? list : list.filter((x) => x.status === tab)
  const drafts = count('draft')

  const onSubmit = (x: TemplateView) =>
    submit.mutate(x.id, {
      onSuccess: () => toast({ title: t('templates.submitted') }),
      onError: (err) => toast({ title: growthError(err, t), tone: 'danger' }),
    })

  return (
    <Page title={t('templates.title')}>
      <p className="max-w-2xl text-body text-ink-muted">{t('templates.intro')}</p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button size="md" onClick={() => setEditing('new')}>
          <PlusIcon aria-hidden />
          {t('templates.new')}
        </Button>
        {drafts > 0 && (
          <Button
            size="md"
            variant="secondary"
            disabled={!templates.data?.hasNumber}
            onClick={() => setSubmitAll(true)}
          >
            <PaperPlaneTiltIcon aria-hidden />
            {t('templates.submitAll', { count: drafts })}
          </Button>
        )}
        <Button
          size="md"
          variant="secondary"
          loading={sync.isPending}
          disabled={!templates.data?.hasNumber}
          onClick={() =>
            sync.mutate(undefined, {
              onSuccess: (r) =>
                toast({ title: t('templates.synced', { count: r.changed + r.added }) }),
              onError: (err) => toast({ title: growthError(err, t), tone: 'danger' }),
            })
          }
        >
          <ArrowsClockwiseIcon aria-hidden />
          {t('templates.sync')}
        </Button>
      </div>
      {templates.data && !templates.data.hasNumber && (
        <p className="mt-3 text-small text-ink-muted">{t('templates.noNumber')}</p>
      )}

      <Tabs<Tab>
        className="mt-5"
        label={t('templates.title')}
        value={tab}
        onChange={setTab}
        tabs={TABS.map((v) => ({ value: v, label: t(`templates.tabs.${v}`), count: count(v) }))}
      />
      <div role="tabpanel" className="mt-3">
        {templates.isError ? (
          <p className="text-body text-danger-600">{t('common.loadError')}</p>
        ) : templates.isPending ? (
          <ListSkeleton rows={6} />
        ) : !shown.length ? (
          <EmptyState
            icon={CardsIcon}
            title={t('templates.emptyTitle')}
            body={t('templates.emptyBody')}
          />
        ) : (
          <ul className="divide-y divide-rule rounded-card border border-rule bg-surface">
            {shown.map((x) => (
              <TemplateLine
                key={x.id}
                template={x}
                onOpen={() => setEditing(x)}
                onSubmit={() => onSubmit(x)}
                submitting={submit.isPending && submit.variables === x.id}
                onDelete={() => setDeleting(x)}
              />
            ))}
          </ul>
        )}
      </div>

      <TemplateEditor
        template={editing}
        onClose={() => setEditing(null)}
        hasNumber={!!templates.data?.hasNumber}
      />

      <ConfirmDialog
        open={submitAll}
        onOpenChange={setSubmitAll}
        title={t('templates.submitAllTitle', { count: drafts })}
        body={t('templates.submitAllBody')}
        confirmLabel={t('templates.submitAllConfirm')}
        cancelLabel={t('common.cancel')}
        loading={all.isPending}
        onConfirm={() =>
          all.mutate(undefined, {
            onSuccess: (r) => {
              setSubmitAll(false)
              toast({
                title: t('templates.submittedAll', { count: r.submitted }),
                body: r.failed.length
                  ? t('templates.someFailed', { names: r.failed.map((f) => f.name).join(', ') })
                  : undefined,
                tone: r.failed.length ? 'danger' : undefined,
              })
            },
            onError: (err) => toast({ title: growthError(err, t), tone: 'danger' }),
          })
        }
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('templates.deleteTitle')}
        body={deleting?.submitted ? t('templates.deleteBodyMeta') : t('templates.deleteBody')}
        confirmLabel={t('templates.delete')}
        cancelLabel={t('common.cancel')}
        danger
        loading={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSuccess: () => setDeleting(null),
            onError: (err) => toast({ title: growthError(err, t), tone: 'danger' }),
          })
        }
      />
    </Page>
  )
}

function TemplateLine({
  template: x,
  onOpen,
  onSubmit,
  submitting,
  onDelete,
}: {
  template: TemplateView
  onOpen(): void
  onSubmit(): void
  submitting: boolean
  onDelete(): void
}) {
  const { t } = useTranslation()
  const editable = x.status === 'draft' || x.status === 'rejected'
  return (
    <li className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:gap-4">
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-h3 text-ink">
            {x.purpose === 'custom' ? x.name : t(`templates.purposes.${x.purpose}`)}
          </span>
          <StatusPill tone={TEMPLATE_TONE[x.status]}>
            {t(`templates.status.${x.status}`)}
          </StatusPill>
        </span>
        <span className="mt-0.5 block text-small text-ink-muted">
          {languageLabel(t, x.name, x.language)} · {t(`templates.categories.${x.category}`)}
          {x.purpose !== 'custom' && ` · ${x.name}`}
        </span>
        <span className="mt-1 line-clamp-2 block text-body text-ink">{x.body}</span>
        {x.rejectionReason && (
          <span className="mt-1 flex items-start gap-1.5 text-small text-danger-600">
            <WarningCircleIcon className="mt-0.5 size-4 shrink-0" weight="bold" aria-hidden />
            {t('templates.rejectedBecause', { reason: x.rejectionReason })}
          </span>
        )}
      </button>
      <div className="flex shrink-0 items-center gap-1">
        {editable && (
          <>
            <Button size="md" variant="secondary" loading={submitting} onClick={onSubmit}>
              <PaperPlaneTiltIcon aria-hidden />
              {t('templates.submit')}
            </Button>
            <IconButton label={t('templates.edit')} onClick={onOpen}>
              <PencilSimpleIcon />
            </IconButton>
          </>
        )}
        {x.purpose === 'custom' && (
          <IconButton label={t('templates.delete')} onClick={onDelete}>
            <TrashIcon />
          </IconButton>
        )}
      </div>
    </li>
  )
}

const MEANINGS = ['contact_name', 'course', 'batch', 'other'] as const
type Meaning = (typeof MEANINGS)[number]

/**
 * New template, or a draft / rejected one to fix. Meta's rules are checked as
 * you type (the same check the API makes), next to a live phone preview.
 */
function TemplateEditor({
  template,
  onClose,
  hasNumber,
}: {
  template: TemplateView | 'new' | null
  onClose(): void
  hasNumber: boolean
}) {
  const { t } = useTranslation()
  const isNew = template === 'new'
  const existing = template && template !== 'new' ? template : null
  const key = isNew ? 'new' : (existing?.id ?? 'none')
  return (
    <Sheet
      open={!!template}
      onOpenChange={(open) => !open && onClose()}
      title={isNew ? t('templates.new') : t('templates.editTitle')}
      closeLabel={t('common.close')}
      className="lg:w-[min(780px,100vw)]"
    >
      {template && (
        <EditorForm key={key} existing={existing} onDone={onClose} hasNumber={hasNumber} />
      )}
    </Sheet>
  )
}

function EditorForm({
  existing,
  onDone,
  hasNumber,
}: {
  existing: TemplateView | null
  onDone(): void
  hasNumber: boolean
}) {
  const { t } = useTranslation()
  const readOnly = !!existing && existing.status !== 'draft' && existing.status !== 'rejected'
  const [name, setName] = useState('')
  const [language, setLanguage] = useState<'hi' | 'en'>(
    existing?.language === 'hi' ? 'hi' : existing ? 'en' : 'hi',
  )
  const [category, setCategory] = useState<'utility' | 'marketing'>(
    existing?.category === 'utility' ? 'utility' : 'marketing',
  )
  const [header, setHeader] = useState(existing?.header ?? '')
  const [body, setBody] = useState(existing?.body ?? '')
  const [footer, setFooter] = useState(existing?.footer ?? '')
  const [buttons, setButtons] = useState<string[]>(
    existing?.buttons?.filter((b) => b.type === 'QUICK_REPLY').map((b) => b.text) ?? [],
  )
  const [meanings, setMeanings] = useState<Meaning[]>(
    (existing?.variables ?? []).map((v) =>
      MEANINGS.includes(v as Meaning) ? (v as Meaning) : 'other',
    ),
  )
  const area = useRef<HTMLTextAreaElement>(null)
  const save = useGrowthMutation(growth.saveTemplate)
  const submit = useGrowthMutation(growth.submitTemplate)

  const parts = useMemo(
    () => ({
      header: header.trim() || undefined,
      body,
      footer: footer.trim() || undefined,
      buttons: buttons.filter((b) => b.trim()).length
        ? buttons
            .filter((b) => b.trim())
            .map((text): TemplateButton => ({ type: 'QUICK_REPLY', text }))
        : undefined,
    }),
    [header, body, footer, buttons],
  )
  const problems = templateProblems(parts)
  const n = variableCount(body)
  const variables = Array.from({ length: n }, (_, i) => meanings[i] ?? 'other')
  const sample = variables.map((v, i) =>
    v === 'other' ? t('templates.sample', { n: i + 1 }) : sampleValue(v, i + 1),
  )
  // The preview, as Meta's own round trip would build it.
  const preview = partsOf(componentsOf(parts))

  const addVariable = (meaning: Meaning) => {
    const el = area.current
    const token = `{{${n + 1}}}`
    const at = el?.selectionStart ?? body.length
    setBody(`${body.slice(0, at)}${token}${body.slice(at)}`)
    setMeanings([...variables, meaning])
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(at + token.length, at + token.length)
    })
  }

  const payload = {
    ...(existing ? { id: existing.id } : { name, language }),
    category,
    header: parts.header ?? null,
    body: body.trim(),
    footer: parts.footer ?? null,
    buttons: parts.buttons ?? [],
    variables,
  }
  const run = (andSubmit: boolean) =>
    save.mutate(payload, {
      onSuccess: (saved) => {
        if (!andSubmit) {
          toast({ title: t('templates.saved') })
          return onDone()
        }
        submit.mutate(saved.id, {
          onSuccess: () => {
            toast({ title: t('templates.submitted') })
            onDone()
          },
          onError: (err) => toast({ title: growthError(err, t), tone: 'danger' }),
        })
      },
      onError: (err) => toast({ title: growthError(err, t), tone: 'danger' }),
    })

  return (
    <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          run(false)
        }}
      >
        {existing ? (
          <p className="text-small text-ink-muted">
            {existing.name} · {languageLabel(t, existing.name, existing.language)}
          </p>
        ) : (
          <>
            <Input
              label={t('templates.name')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              required
              hint={
                name
                  ? t('templates.metaName', { name: templateSlug(name) })
                  : t('templates.nameHint')
              }
            />
            <SegmentedControl<'hi' | 'en'>
              legend={t('templates.language')}
              value={language}
              onChange={setLanguage}
              options={[
                { value: 'hi', label: t('templates.languages.hi') },
                { value: 'en', label: t('templates.languages.enOrHinglish') },
              ]}
            />
          </>
        )}

        <SegmentedControl<'utility' | 'marketing'>
          legend={t('templates.category')}
          value={category}
          onChange={setCategory}
          options={[
            { value: 'utility', label: t('templates.categories.utility') },
            { value: 'marketing', label: t('templates.categories.marketing') },
          ]}
        />
        <p className="-mt-2 text-small text-ink-muted">
          {t(`templates.categoryHelp.${category}`, { rate: categoryRate(category) })}
        </p>

        <Input
          label={t('templates.header')}
          value={header}
          onChange={(e) => setHeader(e.target.value)}
          maxLength={60}
          disabled={readOnly}
        />
        <div className="flex flex-col gap-2">
          <Textarea
            ref={area}
            label={t('templates.body')}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            maxChars={1024}
            disabled={readOnly}
            required
          />
          {!readOnly && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-small text-ink-muted">{t('templates.addBlank')}</span>
              {MEANINGS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => addVariable(m)}
                  className="min-h-9 rounded-full border border-rule bg-surface px-3 text-small text-ink hover:border-ink-muted/60"
                >
                  + {t(`templates.meanings.${m}`)}
                </button>
              ))}
            </div>
          )}
          {n > 0 && (
            <ul className="flex flex-wrap gap-1.5 text-small text-ink-muted">
              {variables.map((v, i) => (
                <li key={i} className="rounded-control bg-ink/5 px-2 py-0.5">
                  {`{{${i + 1}}}`} = {t(`templates.meanings.${v}`)}
                </li>
              ))}
            </ul>
          )}
        </div>
        <Input
          label={t('templates.footer')}
          value={footer}
          onChange={(e) => setFooter(e.target.value)}
          maxLength={60}
          hint={category === 'marketing' ? t('templates.footerHint') : undefined}
          disabled={readOnly}
        />
        <fieldset className="flex flex-col gap-2">
          <legend className="text-small font-semibold text-ink">{t('templates.buttons')}</legend>
          {buttons.map((b, i) => (
            <div key={i} className="flex items-end gap-2">
              <Input
                className="flex-1"
                label={t('templates.buttonN', { n: i + 1 })}
                value={b}
                maxLength={25}
                onChange={(e) => setButtons(buttons.map((x, j) => (j === i ? e.target.value : x)))}
                disabled={readOnly}
              />
              {!readOnly && (
                <IconButton
                  label={t('templates.removeButton')}
                  onClick={() => setButtons(buttons.filter((_, j) => j !== i))}
                >
                  <TrashIcon />
                </IconButton>
              )}
            </div>
          ))}
          {!readOnly && buttons.length < 3 && (
            <Button
              type="button"
              size="md"
              variant="secondary"
              className="self-start"
              onClick={() => setButtons([...buttons, ''])}
            >
              <PlusIcon aria-hidden />
              {t('templates.addButton')}
            </Button>
          )}
        </fieldset>

        {problems.length > 0 && body.trim() && (
          <ul className="flex flex-col gap-1 rounded-card bg-danger-600/10 p-3 text-small text-danger-600">
            {problems.map((p) => (
              <li key={p} className="flex items-start gap-1.5">
                <WarningCircleIcon className="mt-0.5 size-4 shrink-0" weight="bold" aria-hidden />
                {t(`templates.problems.${p}`)}
              </li>
            ))}
          </ul>
        )}

        {readOnly ? (
          <p className="text-small text-ink-muted">{t('templates.readOnly')}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              loading={save.isPending || submit.isPending}
              disabled={!!problems.length || (!existing && !name.trim()) || !hasNumber}
              onClick={() => run(true)}
            >
              <PaperPlaneTiltIcon aria-hidden />
              {t('templates.saveAndSubmit')}
            </Button>
            <Button
              type="submit"
              variant="secondary"
              loading={save.isPending && !submit.isPending}
              disabled={!body.trim() || (!existing && !name.trim())}
            >
              {t('templates.saveDraft')}
            </Button>
          </div>
        )}
        {!hasNumber && !readOnly && (
          <p className="text-small text-ink-muted">
            {t('templates.noNumber')}{' '}
            <Link to="/onboarding" className="font-semibold text-madder-700 underline">
              {t('templates.connect')}
            </Link>
          </p>
        )}
      </form>
      <WhatsAppPreview
        className="self-start lg:sticky lg:top-4"
        header={preview.header}
        body={fillTemplate(body, sample)}
        footer={preview.footer}
        buttons={preview.buttons}
      />
    </div>
  )
}
