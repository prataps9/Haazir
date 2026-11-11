import {
  AddressBookIcon,
  DownloadSimpleIcon,
  MagnifyingGlassIcon,
  TagIcon,
  TrashIcon,
  UploadSimpleIcon,
  UsersThreeIcon,
} from '@phosphor-icons/react'
import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { LEAD_STAGES, type LeadStage } from '@haazir/shared'
import { Page } from '@/app/Page'
import { Button, IconButton } from '@/components/Button'
import { Card } from '@/components/Card'
import { EmptyState } from '@/components/EmptyState'
import { Input } from '@/components/Input'
import { Select } from '@/components/Select'
import { Skeleton } from '@/components/Skeleton'
import { StatusPill, type StatusTone } from '@/components/StatusPill'
import { STAGE_TONE } from '@/features/leads/leadUi'
import { API_BASE } from '@/lib/api'
import {
  contactParams,
  useBulkTag,
  useContacts,
  useContactTags,
  useDeleteSegment,
  useSaveSegment,
  useSegments,
  type Consent,
  type ContactFilters,
  type ContactRow,
} from '@/lib/contacts'
import { errorText } from '@/lib/errors'
import { useMe } from '@/lib/session'
import { useSession } from '@/lib/session-store'
import { toast } from '@/lib/toast'
import { displayName, formatPhone } from '@/lib/types'
import { ImportSheet } from './ImportSheet'

const CONSENT_TONE: Record<Consent, StatusTone> = {
  opted_in: 'success',
  opted_out: 'danger',
  unknown: 'neutral',
}
const CONSENTS: Consent[] = ['opted_in', 'unknown', 'opted_out']

/**
 * Everyone the institute has a number for: who has agreed to updates and who
 * hasn't, with tags to group them. Owners and admins can bring in a list,
 * take one out, and save a set of filters as a segment for campaigns.
 */
export default function ContactsPage() {
  const { t } = useTranslation()
  const { org } = useMe()
  const manager = org?.role === 'owner' || org?.role === 'admin'

  const [input, setInput] = useState('')
  const [filters, setFilters] = useState<ContactFilters>({})
  const [page, setPage] = useState(0)
  const [picked, setPicked] = useState<string[]>([])
  const [importing, setImporting] = useState(false)

  // Search waits for a pause in typing; any change of filter starts at the first page.
  useEffect(() => {
    const id = setTimeout(() => change({ q: input.trim() || undefined }), 300)
    return () => clearTimeout(id)
  }, [input])
  const change = (next: Partial<ContactFilters>) => {
    setFilters((f) => ({ ...f, ...next }))
    setPage(0)
    setPicked([])
  }

  const list = useContacts(filters, page)
  const tags = useContactTags()
  const rows = list.data?.contacts ?? []
  const total = list.data?.total ?? 0
  const pageSize = list.data?.pageSize ?? 50
  const filtered = Object.values(filters).some(Boolean)
  const allPicked = rows.length > 0 && rows.every((r) => picked.includes(r.id))

  const exportCsv = async () => {
    // Through fetch, not a link: the org header has to go with it.
    const res = await fetch(`${API_BASE}/api/v1/contacts/export?${contactParams(filters)}`, {
      credentials: 'include',
      headers: { 'x-org-id': useSession.getState().orgId ?? '' },
    })
    if (!res.ok) return toast({ title: t('common.failed'), tone: 'danger' })
    const url = URL.createObjectURL(await res.blob())
    const a = Object.assign(document.createElement('a'), { href: url, download: 'contacts.csv' })
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Page title={t('contacts.title')}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="relative min-w-0 flex-1 basis-56">
            <span className="sr-only">{t('contacts.search')}</span>
            <MagnifyingGlassIcon
              className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-ink-muted"
              aria-hidden
            />
            <input
              type="search"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t('contacts.search')}
              className="h-12 w-full rounded-control border border-rule bg-surface pr-3 pl-10 text-body text-ink placeholder:text-ink-muted/80 focus-visible:border-focus"
            />
          </label>
          <Select
            label={t('contacts.filterConsent')}
            hideLabel
            className="basis-44"
            value={filters.consent ?? ''}
            onChange={(e) => change({ consent: (e.target.value || undefined) as Consent })}
          >
            <option value="">{t('contacts.anyConsent')}</option>
            {CONSENTS.map((c) => (
              <option key={c} value={c}>
                {t(`contact.optIn.${c}`)}
              </option>
            ))}
          </Select>
          <Select
            label={t('contacts.filterTag')}
            hideLabel
            className="basis-40"
            value={filters.tag ?? ''}
            onChange={(e) => change({ tag: e.target.value || undefined })}
          >
            <option value="">{t('contacts.anyTag')}</option>
            {(tags.data ?? []).map((x) => (
              <option key={x.tag} value={x.tag}>
                {t('contacts.tagWithCount', { tag: x.tag, count: x.count })}
              </option>
            ))}
          </Select>
          <Select
            label={t('contacts.filterStage')}
            hideLabel
            className="basis-40"
            value={filters.stage ?? ''}
            onChange={(e) => change({ stage: (e.target.value || undefined) as LeadStage })}
          >
            <option value="">{t('contacts.anyStage')}</option>
            {LEAD_STAGES.map((s) => (
              <option key={s} value={s}>
                {t(`stages.${s}`)}
              </option>
            ))}
          </Select>
          {manager && (
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setImporting(true)}>
                <UploadSimpleIcon aria-hidden />
                {t('contacts.import')}
              </Button>
              <Button variant="secondary" onClick={() => void exportCsv()}>
                <DownloadSimpleIcon aria-hidden />
                {t('contacts.export')}
              </Button>
            </div>
          )}
        </div>

        {picked.length > 0 && <BulkBar ids={picked} onDone={() => setPicked([])} />}

        {list.isError ? (
          <p className="text-body text-danger-600">{t('common.loadError')}</p>
        ) : !list.data ? (
          <Skeleton className="h-72" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={AddressBookIcon}
            title={filtered ? t('contacts.noneFoundTitle') : t('contacts.emptyTitle')}
            body={filtered ? t('contacts.noneFoundBody') : t('contacts.emptyBody')}
          />
        ) : (
          <div className="overflow-hidden rounded-card border border-rule bg-surface">
            <label className="flex min-h-12 cursor-pointer items-center gap-3 border-b border-rule px-4 text-small font-semibold text-ink">
              <input
                type="checkbox"
                className="size-5 accent-madder-700"
                checked={allPicked}
                onChange={(e) =>
                  setPicked(
                    e.target.checked
                      ? [...new Set([...picked, ...rows.map((r) => r.id)])]
                      : picked.filter((id) => !rows.some((r) => r.id === id)),
                  )
                }
              />
              {picked.length
                ? t('contacts.picked', { count: picked.length })
                : t('contacts.showing', { count: total })}
            </label>
            <ul>
              {rows.map((c) => (
                <Row
                  key={c.id}
                  contact={c}
                  picked={picked.includes(c.id)}
                  onPick={(on) =>
                    setPicked(on ? [...picked, c.id] : picked.filter((id) => id !== c.id))
                  }
                />
              ))}
            </ul>
          </div>
        )}

        {total > pageSize && (
          <div className="flex items-center justify-between gap-3">
            <Button variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>
              {t('contacts.previous')}
            </Button>
            <p className="text-small text-ink-muted tabular">
              {t('contacts.pageOf', { page: page + 1, pages: Math.ceil(total / pageSize) })}
            </p>
            <Button
              variant="secondary"
              disabled={(page + 1) * pageSize >= total}
              onClick={() => setPage(page + 1)}
            >
              {t('contacts.next')}
            </Button>
          </div>
        )}

        {manager && <Segments filters={filters} />}
      </div>
      <ImportSheet open={importing} onOpenChange={setImporting} />
    </Page>
  )
}

function Row({
  contact: c,
  picked,
  onPick,
}: {
  contact: ContactRow
  picked: boolean
  onPick(on: boolean): void
}) {
  const { t } = useTranslation()
  const name = displayName(c)
  const phone = formatPhone(c.waId)
  return (
    <li className="border-b border-rule last:border-b-0">
      <label className="flex cursor-pointer items-start gap-3 px-4 py-3">
        <input
          type="checkbox"
          className="mt-1 size-5 shrink-0 accent-madder-700"
          checked={picked}
          onChange={(e) => onPick(e.target.checked)}
          aria-label={t('contacts.pick', { name })}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body font-semibold text-ink">{name}</span>
          {name !== phone && (
            <span className="block text-small text-ink-muted tabular">{phone}</span>
          )}
          {c.tags.length > 0 && (
            <span className="mt-1.5 flex flex-wrap gap-1.5">
              {c.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-rule px-2 py-0.5 text-small text-ink"
                >
                  {tag}
                </span>
              ))}
            </span>
          )}
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1.5">
          <StatusPill tone={CONSENT_TONE[c.optInStatus]} className="h-6 text-small">
            {t(`contact.optIn.${c.optInStatus}`)}
          </StatusPill>
          {c.stage && (
            <StatusPill tone={STAGE_TONE[c.stage]} className="h-6 text-small">
              {t(`stages.${c.stage}`)}
            </StatusPill>
          )}
        </span>
      </label>
    </li>
  )
}

const splitTags = (text: string) =>
  text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

/** Add or remove a tag on everyone ticked. */
function BulkBar({ ids, onDone }: { ids: string[]; onDone(): void }) {
  const { t } = useTranslation()
  const bulk = useBulkTag()
  const [text, setText] = useState('')
  const run = (mode: 'add' | 'remove') => {
    const tags = splitTags(text)
    if (!tags.length) return
    bulk.mutate(
      { ids, [mode]: tags },
      {
        onSuccess: (r) => {
          toast({ title: t('contacts.tagged', { count: r.updated }), tone: 'success' })
          setText('')
          onDone()
        },
        onError: (err) => toast({ title: errorText(err, t('common.failed')), tone: 'danger' }),
      },
    )
  }
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault()
        run('add')
      }}
      className="flex flex-wrap items-end gap-3 rounded-card border border-rule bg-surface p-4"
    >
      <Input
        className="min-w-0 flex-1 basis-56"
        label={t('contacts.bulkLabel', { count: ids.length })}
        hint={t('contacts.bulkHint')}
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={200}
      />
      <div className="flex gap-2 pb-[26px]">
        <Button type="submit" loading={bulk.isPending} disabled={!text.trim()}>
          <TagIcon aria-hidden />
          {t('contacts.addTag')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={!text.trim() || bulk.isPending}
          onClick={() => run('remove')}
        >
          {t('contacts.removeTag')}
        </Button>
      </div>
    </form>
  )
}

/** Saved audiences: the tag and stage filters above, kept under a name for campaigns. */
function Segments({ filters }: { filters: ContactFilters }) {
  const { t } = useTranslation()
  const segments = useSegments()
  const save = useSaveSegment()
  const remove = useDeleteSegment()
  const [name, setName] = useState('')
  const [error, setError] = useState<string>()
  const savable = !!filters.tag || !!filters.stage

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setError(undefined)
    save.mutate(
      {
        name: name.trim(),
        filters: {
          tags: filters.tag ? [filters.tag] : undefined,
          stages: filters.stage ? [filters.stage] : undefined,
        },
      },
      {
        onSuccess: () => {
          toast({ title: t('contacts.segmentSaved'), tone: 'success' })
          setName('')
        },
        onError: (err) => setError(errorText(err, t('common.failed'))),
      },
    )
  }

  return (
    <Card title={t('contacts.segments')} description={t('contacts.segmentsBody')}>
      <div className="flex flex-col gap-4">
        {segments.data && segments.data.length > 0 && (
          <ul className="flex flex-col">
            {segments.data.map((s) => (
              <li
                key={s.id}
                className="flex items-center gap-3 border-b border-rule py-2 last:border-b-0"
              >
                <UsersThreeIcon className="size-6 shrink-0 text-madder-700" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body font-semibold text-ink">{s.name}</p>
                  <p className="text-small text-ink-muted">
                    {t('contacts.segmentReach', { count: s.count })}
                    {s.optedOut + s.noConsent > 0 &&
                      ` ${t('contacts.segmentLeftOut', { count: s.optedOut + s.noConsent })}`}
                  </p>
                </div>
                <IconButton
                  label={t('contacts.deleteSegment', { name: s.name })}
                  onClick={() =>
                    remove.mutate(s.id, {
                      onError: () => toast({ title: t('common.failed'), tone: 'danger' }),
                    })
                  }
                >
                  <TrashIcon />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={submit} className="flex flex-wrap items-start gap-3">
          <Input
            className="min-w-0 flex-1 basis-56"
            label={t('contacts.segmentName')}
            hint={savable ? t('contacts.segmentHint') : t('contacts.segmentPickFirst')}
            error={error}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            disabled={!savable}
            required
          />
          <Button
            type="submit"
            variant="secondary"
            className="mt-[26px]"
            loading={save.isPending}
            disabled={!savable || !name.trim()}
          >
            {t('contacts.saveSegment')}
          </Button>
        </form>
      </div>
    </Card>
  )
}
