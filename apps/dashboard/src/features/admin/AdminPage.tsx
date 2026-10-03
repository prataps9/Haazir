import { BuildingsIcon, CopyIcon, PlugsConnectedIcon, PlusIcon } from '@phosphor-icons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Page } from '@/app/Page'
import { Button } from '@/components/Button'
import { EmptyState } from '@/components/EmptyState'
import { Input } from '@/components/Input'
import { Sheet } from '@/components/Sheet'
import { ListSkeleton } from '@/components/Skeleton'
import { StatusPill, type StatusTone } from '@/components/StatusPill'
import { api, post } from '@/lib/api'
import { errorText } from '@/lib/errors'
import { usePreferences } from '@/lib/preferences'
import { useMe } from '@/lib/session'
import { listTime } from '@/lib/time'
import { toast } from '@/lib/toast'

interface OrgRow {
  id: string
  name: string
  city: string | null
  status: string
  plan: string | null
  members: number
  whatsappStatus: WaStatus | null
  lastActivity: string | null
}
type WaStatus = 'connected' | 'error' | 'disconnected'
interface WaAccount {
  id: string
  wabaId: string
  phoneNumberId: string
  displayPhone: string | null
  verifiedName: string | null
  qualityRating: string | null
  status: WaStatus
  lastError: string | null
}
interface OrgDetail {
  org: { id: string; name: string; city: string | null; slug: string }
  whatsappAccounts: WaAccount[]
  stats: { conversations: number; lastActivity: string | null }
}

const WA_TONE: Record<WaStatus, StatusTone> = {
  connected: 'success',
  error: 'danger',
  disconnected: 'neutral',
}

/**
 * Super admin (spec §16.16; the full console is Phase 6). Phase 3: create an
 * institute with an owner invite, and connect its WhatsApp number by hand.
 */
export default function AdminPage() {
  const { t } = useTranslation()
  const { me } = useMe()
  const lang = usePreferences((s) => s.language)
  const [creating, setCreating] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const orgs = useQuery({
    queryKey: ['admin', 'orgs'],
    enabled: !!me?.user.isSuperAdmin,
    queryFn: () => api<{ orgs: OrgRow[] }>('/api/v1/admin/orgs').then((r) => r.orgs),
  })

  if (me && !me.user.isSuperAdmin) {
    return (
      <Page title={t('admin.title')}>
        <p className="text-body text-ink-muted">{t('admin.onlySuperAdmin')}</p>
      </Page>
    )
  }

  return (
    <Page title={t('admin.title')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-h2 text-ink">{t('admin.orgs')}</h2>
        <Button onClick={() => setCreating(true)}>
          <PlusIcon weight="bold" aria-hidden />
          {t('admin.create')}
        </Button>
      </div>

      <div className="mt-4">
        {orgs.isError ? (
          <p className="text-body text-danger-600">{t('common.loadError')}</p>
        ) : orgs.isPending ? (
          <ListSkeleton rows={4} />
        ) : !orgs.data.length ? (
          <EmptyState
            icon={BuildingsIcon}
            title={t('admin.emptyTitle')}
            body={t('admin.emptyBody')}
          />
        ) : (
          <ul className="divide-y divide-rule rounded-card border border-rule bg-surface">
            {orgs.data.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(o.id)}
                  className="grid w-full gap-2 p-4 text-left transition-colors duration-150 hover:bg-ink/[0.03] sm:grid-cols-[minmax(0,2fr)_1fr_1fr_1fr] sm:items-center"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-body font-semibold text-ink">
                      {o.name}
                    </span>
                    <span className="block text-small text-ink-muted">
                      {[o.city, o.plan].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="text-small text-ink-muted tabular">
                    {t('admin.members')}: {o.members}
                  </span>
                  <span>
                    <StatusPill tone={o.whatsappStatus ? WA_TONE[o.whatsappStatus] : 'neutral'}>
                      {o.whatsappStatus ? t(`admin.status.${o.whatsappStatus}`) : t('admin.none')}
                    </StatusPill>
                  </span>
                  <span className="text-small text-ink-muted">
                    {t('admin.lastActivity')}:{' '}
                    {o.lastActivity ? listTime(o.lastActivity, lang) : '—'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <CreateOrgSheet open={creating} onOpenChange={setCreating} />
      <OrgSheet orgId={openId} onClose={() => setOpenId(null)} />
    </Page>
  )
}

function CopyLink({ url }: { url: string }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-2 rounded-card border border-pottery-600/30 bg-pottery-50 p-4">
      <p className="text-body text-ink">{t('admin.inviteReady')}</p>
      <p className="font-mono text-small break-all text-ink">{url}</p>
      <Button
        variant="secondary"
        size="md"
        className="self-start"
        onClick={() =>
          void navigator.clipboard
            .writeText(url)
            .then(() => toast({ title: t('common.copied'), tone: 'success' }))
            .catch(() => toast({ title: t('common.failed'), tone: 'danger' }))
        }
      >
        <CopyIcon aria-hidden />
        {t('common.copy')}
      </Button>
    </div>
  )
}

function CreateOrgSheet({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange(open: boolean): void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [form, setForm] = useState({ name: '', city: '', ownerName: '', ownerEmail: '' })
  const [inviteUrl, setInviteUrl] = useState<string>()
  const [error, setError] = useState<string>()
  const create = useMutation({
    mutationFn: () => post<{ inviteUrl: string }>('/api/v1/admin/orgs', form),
    onSuccess: (res) => {
      setInviteUrl(res.inviteUrl)
      void qc.invalidateQueries({ queryKey: ['admin'] })
    },
    onError: (err) => setError(errorText(err, t('common.failed'))),
  })

  const close = (next: boolean) => {
    if (next) return onOpenChange(true)
    setForm({ name: '', city: '', ownerName: '', ownerEmail: '' })
    setInviteUrl(undefined)
    setError(undefined)
    onOpenChange(false)
  }
  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value }),
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setError(undefined)
    create.mutate()
  }

  return (
    <Sheet
      open={open}
      onOpenChange={close}
      title={t('admin.create')}
      closeLabel={t('common.close')}
    >
      <div className="px-5 pt-2 pb-6">
        {inviteUrl ? (
          <CopyLink url={inviteUrl} />
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <Input
              label={t('admin.name')}
              {...field('name')}
              required
              minLength={2}
              maxLength={120}
            />
            <Input
              label={t('admin.city')}
              {...field('city')}
              required
              minLength={2}
              maxLength={60}
            />
            <Input label={t('admin.ownerName')} {...field('ownerName')} required maxLength={100} />
            <Input
              label={t('admin.ownerEmail')}
              type="email"
              autoComplete="off"
              {...field('ownerEmail')}
              required
            />
            {error && (
              <p role="alert" className="text-body text-danger-600">
                {error}
              </p>
            )}
            <Button type="submit" block loading={create.isPending}>
              {t('admin.createButton')}
            </Button>
          </form>
        )}
      </div>
    </Sheet>
  )
}

function OrgSheet({ orgId, onClose }: { orgId: string | null; onClose(): void }) {
  const { t } = useTranslation()
  const detail = useQuery({
    queryKey: ['admin', 'org', orgId],
    enabled: !!orgId,
    queryFn: () => api<OrgDetail>(`/api/v1/admin/orgs/${orgId}`),
  })
  const d = detail.data

  return (
    <Sheet
      open={!!orgId}
      onOpenChange={(open) => !open && onClose()}
      title={d?.org.name ?? t('common.loading')}
      closeLabel={t('common.close')}
    >
      <div className="flex flex-col gap-5 px-5 pt-2 pb-6">
        {detail.isError && <p className="text-body text-danger-600">{t('common.loadError')}</p>}
        {d && (
          <>
            <p className="text-small text-ink-muted">
              {[d.org.city, d.org.slug].filter(Boolean).join(' · ')}
            </p>
            <section className="flex flex-col gap-3">
              <h3 className="text-h3 text-ink">{t('admin.whatsapp')}</h3>
              {d.whatsappAccounts.length === 0 && (
                <p className="text-body text-ink-muted">{t('admin.none')}</p>
              )}
              {d.whatsappAccounts.map((a) => (
                <AccountCard key={a.id} orgId={d.org.id} account={a} />
              ))}
            </section>
            <ConnectForm orgId={d.org.id} />
          </>
        )}
      </div>
    </Sheet>
  )
}

function AccountCard({ orgId, account }: { orgId: string; account: WaAccount }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const test = useMutation({
    mutationFn: () =>
      post<
        | { ok: true; displayPhone: string; verifiedName: string; qualityRating: string }
        | { ok: false; error: string }
      >(`/api/v1/admin/orgs/${orgId}/whatsapp/${account.id}/test`),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['admin'] })
      toast(
        res.ok
          ? {
              title: t('admin.testOk', {
                phone: res.displayPhone,
                name: res.verifiedName,
                quality: res.qualityRating,
              }),
              tone: 'success',
            }
          : { title: t('admin.testFailed', { error: res.error }), tone: 'danger' },
        8000,
      )
    },
    onError: (err) => toast({ title: errorText(err, t('common.failed')), tone: 'danger' }),
  })

  return (
    <div className="flex flex-col gap-2 rounded-card border border-rule p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-body font-semibold text-ink tabular">
          {account.displayPhone ?? account.phoneNumberId}
        </p>
        <StatusPill tone={WA_TONE[account.status]}>
          {t(`admin.status.${account.status}`)}
        </StatusPill>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-small text-ink-muted">
        {account.verifiedName && (
          <>
            <dt>{t('admin.verifiedName')}</dt>
            <dd className="text-ink">{account.verifiedName}</dd>
          </>
        )}
        <dt>{t('admin.phoneNumberId')}</dt>
        <dd className="text-ink tabular">{account.phoneNumberId}</dd>
        <dt>WABA</dt>
        <dd className="text-ink tabular">{account.wabaId}</dd>
        {account.qualityRating && (
          <>
            <dt>{t('admin.quality')}</dt>
            <dd className="text-ink">{account.qualityRating}</dd>
          </>
        )}
      </dl>
      {account.lastError && <p className="text-small text-danger-600">{account.lastError}</p>}
      <Button
        variant="secondary"
        size="md"
        className="self-start"
        loading={test.isPending}
        onClick={() => test.mutate()}
      >
        <PlugsConnectedIcon aria-hidden />
        {t('admin.test')}
      </Button>
    </div>
  )
}

function ConnectForm({ orgId }: { orgId: string }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [form, setForm] = useState({ wabaId: '', phoneNumberId: '', accessToken: '' })
  const [error, setError] = useState<string>()
  const connect = useMutation({
    mutationFn: () => post<WaAccount>(`/api/v1/admin/orgs/${orgId}/whatsapp`, form),
    onSuccess: () => {
      setForm({ wabaId: '', phoneNumberId: '', accessToken: '' })
      toast({ title: t('admin.connected'), tone: 'success' })
      void qc.invalidateQueries({ queryKey: ['admin'] })
    },
    onError: (err) => setError(errorText(err, t('common.failed'))),
  })
  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value }),
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        setError(undefined)
        connect.mutate()
      }}
      className="flex flex-col gap-4 border-t border-rule pt-5"
    >
      <h3 className="text-h3 text-ink">{t('admin.connect')}</h3>
      <Input label={t('admin.wabaId')} inputMode="numeric" {...field('wabaId')} required />
      <Input
        label={t('admin.phoneNumberId')}
        inputMode="numeric"
        {...field('phoneNumberId')}
        required
      />
      <Input
        label={t('admin.accessToken')}
        hint={t('admin.accessTokenHint')}
        type="password"
        autoComplete="off"
        {...field('accessToken')}
        required
      />
      {error && (
        <p role="alert" className="text-body text-danger-600">
          {error}
        </p>
      )}
      <Button type="submit" variant="secondary" loading={connect.isPending}>
        {t('admin.connectButton')}
      </Button>
    </form>
  )
}
