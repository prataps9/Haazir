import {
  BookOpenTextIcon,
  ChatCircleTextIcon,
  FilePdfIcon,
  GlobeIcon,
  NotePencilIcon,
  QuestionIcon,
  SealCheckIcon,
  TextAlignLeftIcon,
  TrashIcon,
  type Icon,
} from '@phosphor-icons/react'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import { Page } from '@/app/Page'
import { Button, IconButton } from '@/components/Button'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { Input } from '@/components/Input'
import { Sheet } from '@/components/Sheet'
import { ListSkeleton } from '@/components/Skeleton'
import { StatusPill, type StatusTone } from '@/components/StatusPill'
import { Tabs } from '@/components/Tabs'
import { Textarea } from '@/components/Textarea'
import { errorText } from '@/lib/errors'
import { usePreferences } from '@/lib/preferences'
import { useMe } from '@/lib/session'
import { listTime } from '@/lib/time'
import { toast } from '@/lib/toast'
import { Playground } from './Playground'
import {
  useAddSource,
  useBotConfig,
  useDeleteFaq,
  useDeleteSource,
  useFaqs,
  useResolveUnanswered,
  useSaveFaq,
  useSources,
  useUnanswered,
  type Faq,
  type Source,
  type SourceStatus,
  type SourceType,
  type Unanswered,
} from './queries'

type Tab = 'documents' | 'faqs' | 'unanswered' | 'test'
const TABS: Tab[] = ['documents', 'faqs', 'unanswered', 'test']

/**
 * "Bot ko sikhayein" (spec §16.10): what the bot knows, what it couldn't
 * answer, and a box to try it. Agents can read and test; teaching is for the
 * owner and admins, which the API enforces too.
 */
export default function KnowledgePage() {
  const { t } = useTranslation()
  const { org } = useMe()
  const [params, setParams] = useSearchParams()
  const tab = TABS.includes(params.get('tab') as Tab) ? (params.get('tab') as Tab) : 'documents'
  const orgId = org?.id
  const canTeach = org?.role === 'owner' || org?.role === 'admin'

  const sources = useSources(orgId)
  const faqs = useFaqs(orgId)
  const unanswered = useUnanswered(orgId)
  const bot = useBotConfig(orgId)
  const documents = sources.data?.filter((s) => s.type !== 'faq')

  return (
    <Page title={t('knowledge.title')}>
      <p className="max-w-[60ch] text-body text-ink-muted">{t('knowledge.intro')}</p>
      <Tabs
        className="mt-4"
        label={t('knowledge.title')}
        value={tab}
        onChange={(next) => setParams(next === 'documents' ? {} : { tab: next }, { replace: true })}
        tabs={[
          { value: 'documents', label: t('knowledge.tabs.documents') },
          { value: 'faqs', label: t('knowledge.tabs.faqs'), count: faqs.data?.length },
          {
            value: 'unanswered',
            label: t('knowledge.tabs.unanswered'),
            count: unanswered.data?.length,
          },
          { value: 'test', label: t('knowledge.tabs.test') },
        ]}
      />
      <div role="tabpanel" className="mt-5">
        {tab === 'documents' && (
          <Documents
            sources={documents}
            loading={sources.isPending}
            failed={sources.isError}
            canTeach={canTeach}
          />
        )}
        {tab === 'faqs' && (
          <Faqs
            faqs={faqs.data}
            loading={faqs.isPending}
            failed={faqs.isError}
            canTeach={canTeach}
          />
        )}
        {tab === 'unanswered' && (
          <UnansweredList
            questions={unanswered.data}
            loading={unanswered.isPending}
            failed={unanswered.isError}
            canTeach={canTeach}
          />
        )}
        {tab === 'test' && (
          <Playground
            className="max-w-2xl"
            endpoint="knowledge"
            aiConfigured={bot.data?.aiConfigured ?? true}
            suggestions={t('knowledge.suggestions', { returnObjects: true }) as string[]}
          />
        )}
      </div>
    </Page>
  )
}

function LoadError() {
  const { t } = useTranslation()
  return <p className="text-body text-danger-600">{t('common.loadError')}</p>
}

// ---------------------------------------------------------------- Documents

const TYPE_ICON: Record<SourceType, Icon> = {
  faq: ChatCircleTextIcon,
  text: TextAlignLeftIcon,
  pdf: FilePdfIcon,
  url: GlobeIcon,
}
const STATUS_TONE: Record<SourceStatus, StatusTone> = {
  pending: 'attention',
  processing: 'attention',
  ready: 'success',
  failed: 'danger',
}

function Documents({
  sources,
  loading,
  failed,
  canTeach,
}: {
  sources?: Source[]
  loading: boolean
  failed: boolean
  canTeach: boolean
}) {
  const { t } = useTranslation()
  const [adding, setAdding] = useState<'text' | 'url' | 'pdf' | null>(null)
  const [removing, setRemoving] = useState<Source | null>(null)
  const remove = useDeleteSource()

  const addButtons = canTeach && (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" size="md" onClick={() => setAdding('pdf')}>
        <FilePdfIcon aria-hidden />
        {t('knowledge.addPdf')}
      </Button>
      <Button variant="secondary" size="md" onClick={() => setAdding('url')}>
        <GlobeIcon aria-hidden />
        {t('knowledge.addUrl')}
      </Button>
      <Button variant="secondary" size="md" onClick={() => setAdding('text')}>
        <TextAlignLeftIcon aria-hidden />
        {t('knowledge.addText')}
      </Button>
    </div>
  )

  return (
    <div className="flex flex-col gap-4">
      {addButtons}
      {failed ? (
        <LoadError />
      ) : loading ? (
        <ListSkeleton rows={3} />
      ) : !sources?.length ? (
        <EmptyState
          icon={BookOpenTextIcon}
          title={t('knowledge.emptyDocsTitle')}
          body={t('knowledge.emptyDocsBody')}
        />
      ) : (
        <ul className="divide-y divide-rule rounded-card border border-rule bg-surface">
          {sources.map((s) => {
            const Glyph = TYPE_ICON[s.type]
            return (
              <li key={s.id} className="flex items-start gap-3 p-4">
                <Glyph
                  className="mt-0.5 size-6 shrink-0 text-ink-muted"
                  weight="duotone"
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body font-semibold text-ink">{s.title}</p>
                  <p className="truncate text-small text-ink-muted">
                    {t(`knowledge.types.${s.type}`)}
                    {s.url ? ` · ${s.url}` : ''}
                    {s.status === 'ready'
                      ? ` · ${t('knowledge.chunks', { count: s.chunkCount })}`
                      : ''}
                  </p>
                  <StatusPill tone={STATUS_TONE[s.status]} className="mt-2">
                    {t(`knowledge.status.${s.status}`)}
                  </StatusPill>
                  {s.status === 'failed' && s.error && (
                    <p className="mt-1 text-small text-danger-600">{s.error}</p>
                  )}
                </div>
                {canTeach && (
                  <IconButton label={t('common.delete')} onClick={() => setRemoving(s)}>
                    <TrashIcon />
                  </IconButton>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <AddSourceSheet kind={adding} onClose={() => setAdding(null)} />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={t('knowledge.confirmDelete')}
        body={removing?.title}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        danger
        loading={remove.isPending}
        onConfirm={() =>
          removing &&
          remove.mutate(removing.id, {
            onSuccess: () => {
              setRemoving(null)
              toast({ title: t('knowledge.deleted'), tone: 'neutral' })
            },
            onError: (err) => toast({ title: errorText(err, t('common.failed')), tone: 'danger' }),
          })
        }
      />
    </div>
  )
}

function AddSourceSheet({
  kind,
  onClose,
}: {
  kind: 'text' | 'url' | 'pdf' | null
  onClose(): void
}) {
  const { t } = useTranslation()
  const add = useAddSource()
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [url, setUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string>()

  const close = () => {
    setTitle('')
    setText('')
    setUrl('')
    setFile(null)
    setError(undefined)
    onClose()
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!kind) return
    const body =
      kind === 'text'
        ? { type: 'text' as const, title, text }
        : kind === 'url'
          ? { type: 'url' as const, url }
          : file && { type: 'pdf' as const, file, title: title || undefined }
    if (!body) return
    add.mutate(body, {
      onSuccess: () => {
        toast({ title: t('knowledge.added'), tone: 'success' })
        close()
      },
      onError: (err) => setError(errorText(err, t('common.failed'))),
    })
  }

  const heading =
    kind === 'text'
      ? t('knowledge.addText')
      : kind === 'url'
        ? t('knowledge.addUrl')
        : t('knowledge.addPdf')
  return (
    <Sheet
      open={!!kind}
      onOpenChange={(open) => !open && close()}
      title={heading}
      closeLabel={t('common.close')}
    >
      <form onSubmit={submit} className="flex flex-col gap-4 px-5 pt-2 pb-6">
        {kind === 'text' && (
          <>
            <Input
              label={t('knowledge.sourceTitle')}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              maxLength={200}
            />
            <Textarea
              label={t('knowledge.sourceText')}
              hint={t('knowledge.sourceTextHint')}
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={10}
              required
              minLength={20}
            />
          </>
        )}
        {kind === 'url' && (
          <Input
            label={t('knowledge.url')}
            hint={t('knowledge.urlHint')}
            type="url"
            inputMode="url"
            placeholder="https://"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
          />
        )}
        {kind === 'pdf' && (
          <>
            <Input
              label={t('knowledge.pdf')}
              type="file"
              accept="application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              required
              className="[&_input]:py-2.5"
            />
            <Input
              label={t('knowledge.sourceTitle')}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
            />
          </>
        )}
        {error && (
          <p role="alert" className="text-body text-danger-600">
            {error}
          </p>
        )}
        <Button type="submit" block loading={add.isPending}>
          {t('knowledge.add')}
        </Button>
      </form>
    </Sheet>
  )
}

// ---------------------------------------------------------------- FAQs

function Faqs({
  faqs,
  loading,
  failed,
  canTeach,
}: {
  faqs?: Faq[]
  loading: boolean
  failed: boolean
  canTeach: boolean
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState<string | null>(null)
  const [removing, setRemoving] = useState<Faq | null>(null)
  const remove = useDeleteFaq()

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      {canTeach && (
        <section className="rounded-card border border-rule bg-surface p-4 sm:p-5">
          <h2 className="text-h3 text-ink">{t('knowledge.addFaq')}</h2>
          <FaqForm className="mt-4" />
        </section>
      )}
      {failed ? (
        <LoadError />
      ) : loading ? (
        <ListSkeleton rows={3} />
      ) : !faqs?.length ? (
        <EmptyState
          icon={ChatCircleTextIcon}
          title={t('knowledge.emptyFaqsTitle')}
          body={t('knowledge.emptyFaqsBody')}
        />
      ) : (
        <ul className="divide-y divide-rule rounded-card border border-rule bg-surface">
          {faqs.map((faq) => (
            <li key={faq.id} className="p-4">
              {editing === faq.id ? (
                <FaqForm faq={faq} onDone={() => setEditing(null)} />
              ) : (
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-body font-semibold text-ink">{faq.question}</p>
                    <p className="mt-1 text-body whitespace-pre-wrap text-ink-muted">
                      {faq.answer}
                    </p>
                  </div>
                  {canTeach && (
                    <div className="flex shrink-0">
                      <IconButton label={t('common.edit')} onClick={() => setEditing(faq.id)}>
                        <NotePencilIcon />
                      </IconButton>
                      <IconButton label={t('common.delete')} onClick={() => setRemoving(faq)}>
                        <TrashIcon />
                      </IconButton>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={t('knowledge.confirmDelete')}
        body={removing?.question}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        danger
        loading={remove.isPending}
        onConfirm={() =>
          removing &&
          remove.mutate(removing.id, {
            onSuccess: () => {
              setRemoving(null)
              toast({ title: t('knowledge.deleted'), tone: 'neutral' })
            },
            onError: (err) => toast({ title: errorText(err, t('common.failed')), tone: 'danger' }),
          })
        }
      />
    </div>
  )
}

function FaqForm({ faq, onDone, className }: { faq?: Faq; onDone?(): void; className?: string }) {
  const { t } = useTranslation()
  const save = useSaveFaq()
  const [question, setQuestion] = useState(faq?.question ?? '')
  const [answer, setAnswer] = useState(faq?.answer ?? '')
  const [error, setError] = useState<string>()

  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate(
      { id: faq?.id, question, answer },
      {
        onSuccess: () => {
          toast({ title: t('knowledge.learned'), tone: 'success' })
          setError(undefined)
          if (!faq) {
            setQuestion('')
            setAnswer('')
          }
          onDone?.()
        },
        onError: (err) => setError(errorText(err, t('common.failed'))),
      },
    )
  }

  return (
    <form onSubmit={submit} className={className}>
      <div className="flex flex-col gap-3">
        <Input
          label={t('knowledge.question')}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          required
          minLength={3}
          maxLength={500}
        />
        <Textarea
          label={t('knowledge.answer')}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          required
          maxLength={2000}
          rows={3}
        />
        {error && (
          <p role="alert" className="text-body text-danger-600">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <Button
            type="submit"
            variant={faq ? 'primary' : 'secondary'}
            size="md"
            loading={save.isPending}
          >
            {faq ? t('knowledge.saveFaq') : t('knowledge.add')}
          </Button>
          {onDone && (
            <Button variant="ghost" size="md" onClick={onDone}>
              {t('common.cancel')}
            </Button>
          )}
        </div>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------- Unanswered

function UnansweredList({
  questions,
  loading,
  failed,
  canTeach,
}: {
  questions?: Unanswered[]
  loading: boolean
  failed: boolean
  canTeach: boolean
}) {
  const { t } = useTranslation()
  if (failed) return <LoadError />
  if (loading) return <ListSkeleton rows={3} />
  if (!questions?.length)
    return (
      <EmptyState
        icon={SealCheckIcon}
        title={t('knowledge.emptyUnansweredTitle')}
        body={t('knowledge.emptyUnansweredBody')}
      />
    )
  return (
    <ul className="flex max-w-3xl flex-col divide-y divide-rule rounded-card border border-rule bg-surface">
      {questions.map((q) => (
        <UnansweredItem key={q.id} q={q} canTeach={canTeach} />
      ))}
    </ul>
  )
}

function UnansweredItem({ q, canTeach }: { q: Unanswered; canTeach: boolean }) {
  const { t } = useTranslation()
  const lang = usePreferences((s) => s.language)
  const resolve = useResolveUnanswered()
  const [open, setOpen] = useState(false)
  const [question, setQuestion] = useState(q.question)
  const [answer, setAnswer] = useState('')
  const [error, setError] = useState<string>()

  const submit = (e: FormEvent) => {
    e.preventDefault()
    resolve.mutate(
      { id: q.id, question, answer },
      {
        onSuccess: () => toast({ title: t('knowledge.learned'), tone: 'success' }),
        onError: (err) => setError(errorText(err, t('common.failed'))),
      },
    )
  }

  return (
    <li className="p-4">
      <div className="flex items-start gap-3">
        <QuestionIcon
          className="mt-0.5 size-6 shrink-0 text-marigold-500"
          weight="duotone"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="text-body font-semibold text-ink">{q.question}</p>
          <p className="text-small text-ink-muted">
            {t('knowledge.askedTimes', { count: q.count })} · {listTime(q.lastSeenAt, lang)}
          </p>
        </div>
        {canTeach && !open && (
          <Button variant="secondary" size="md" onClick={() => setOpen(true)}>
            {t('knowledge.writeAnswer')}
          </Button>
        )}
      </div>
      {open && (
        <form onSubmit={submit} className="mt-3 flex flex-col gap-3 sm:pl-9">
          <Input
            label={t('knowledge.question')}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            required
            minLength={3}
            maxLength={500}
          />
          <Textarea
            label={t('knowledge.answer')}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            required
            maxLength={2000}
            rows={3}
            autoFocus
          />
          {error && (
            <p role="alert" className="text-body text-danger-600">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="submit" size="md" loading={resolve.isPending}>
              {t('knowledge.saveFaq')}
            </Button>
            <Button variant="ghost" size="md" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      )}
    </li>
  )
}
