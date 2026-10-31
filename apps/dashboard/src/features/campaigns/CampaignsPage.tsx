import { MegaphoneIcon, PlusIcon } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import { Page } from '@/app/Page'
import { Button } from '@/components/Button'
import { EmptyState } from '@/components/EmptyState'
import { ListSkeleton } from '@/components/Skeleton'
import { StatusPill } from '@/components/StatusPill'
import { formatCount, formatPaise } from '@/lib/format'
import { growth, useCampaigns, useGrowthMutation, type CampaignView } from '@/lib/growth'
import { usePreferences } from '@/lib/preferences'
import { toast } from '@/lib/toast'
import { growthError } from '../templates/templateUi'
import { CAMPAIGN_TONE } from './campaignUi'

/** Campaigns (spec §16.8): one approved message to many opted-in people, and what came of it. */
export default function CampaignsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const campaigns = useCampaigns()
  const create = useGrowthMutation(growth.saveCampaign)
  const lang = usePreferences((s) => s.language)

  const start = () =>
    create.mutate(
      {
        name: t('campaigns.defaultName', {
          date: new Intl.DateTimeFormat(lang === 'hi' ? 'hi-IN' : 'en-IN', {
            day: 'numeric',
            month: 'short',
            timeZone: 'Asia/Kolkata',
          }).format(new Date()),
        }),
      },
      {
        onSuccess: (c) => navigate(`/campaigns/${c.id}`),
        onError: (err) => toast({ title: growthError(err, t), tone: 'danger' }),
      },
    )

  return (
    <Page title={t('campaigns.title')}>
      <p className="max-w-2xl text-body text-ink-muted">{t('campaigns.intro')}</p>
      <Button size="md" className="mt-4" loading={create.isPending} onClick={start}>
        <PlusIcon aria-hidden />
        {t('campaigns.new')}
      </Button>

      <div className="mt-5">
        {campaigns.isError ? (
          <p className="text-body text-danger-600">{t('common.loadError')}</p>
        ) : campaigns.isPending ? (
          <ListSkeleton rows={4} />
        ) : !campaigns.data.length ? (
          <EmptyState
            icon={MegaphoneIcon}
            title={t('campaigns.emptyTitle')}
            body={t('campaigns.emptyBody')}
          />
        ) : (
          <ul className="divide-y divide-rule rounded-card border border-rule bg-surface">
            {campaigns.data.map((c) => (
              <CampaignLine key={c.id} campaign={c} />
            ))}
          </ul>
        )}
      </div>
    </Page>
  )
}

function CampaignLine({ campaign: c }: { campaign: CampaignView }) {
  const { t } = useTranslation()
  const lang = usePreferences((s) => s.language)
  const when = c.startedAt ?? c.scheduledAt ?? c.createdAt
  const tone = CAMPAIGN_TONE[c.status]
  return (
    <li>
      <Link
        to={`/campaigns/${c.id}`}
        className="flex flex-col gap-2 p-4 hover:bg-ink/5 sm:flex-row sm:items-center sm:gap-4"
      >
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-h3 text-ink">{c.name}</span>
            <StatusPill tone={tone.tone} icon={tone.icon}>
              {t(`campaigns.status.${c.status}`)}
            </StatusPill>
          </span>
          <span className="mt-0.5 block text-small text-ink-muted">
            {c.template ? c.template.name : t('campaigns.noTemplateYet')} ·{' '}
            {new Intl.DateTimeFormat(lang === 'hi' ? 'hi-IN' : 'en-IN', {
              day: 'numeric',
              month: 'short',
              hour: 'numeric',
              minute: '2-digit',
              timeZone: 'Asia/Kolkata',
            }).format(new Date(when))}
          </span>
        </span>
        {c.stats ? (
          <dl className="grid shrink-0 grid-cols-4 gap-3 text-small">
            {(['sent', 'delivered', 'read', 'failed'] as const).map((k) => (
              <div key={k}>
                <dt className="text-ink-muted">{t(`campaigns.results.${k}`)}</dt>
                <dd className="font-semibold text-ink tabular">{formatCount(c.stats![k])}</dd>
              </div>
            ))}
          </dl>
        ) : c.estimatedCostPaise != null ? (
          <span className="text-small text-ink-muted">~{formatPaise(c.estimatedCostPaise)}</span>
        ) : null}
      </Link>
    </li>
  )
}
