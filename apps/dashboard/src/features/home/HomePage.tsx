import { ChalkboardTeacherIcon, ChatsCircleIcon, RocketLaunchIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Page } from '@/app/Page'
import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { LedgerCard, type LedgerRow } from '@/components/LedgerCard'
import { SegmentedControl } from '@/components/SegmentedControl'
import { Skeleton } from '@/components/Skeleton'
import { StatusPill } from '@/components/StatusPill'
import { crm, useCrmMutation, useOrg, useSummary, type Summary } from '@/lib/crm'
import { errorText } from '@/lib/errors'
import { formatLongDate, formatPaise } from '@/lib/format'
import { usePreferences } from '@/lib/preferences'
import { clock } from '@/lib/time'
import { toast } from '@/lib/toast'
import { FEE_TONE, feeDate } from '@/features/fees/feeUi'

/**
 * "Aaj ka hisaab" (spec §16.3): the day in one ledger, then what needs doing:
 * chats waiting, today's demos to mark, fees to chase, questions to teach.
 */
export default function HomePage() {
  const { t } = useTranslation()
  const lang = usePreferences((s) => s.language)
  const [range, setRange] = useState<Summary['range']>('today')
  const summary = useSummary(range)
  const org = useOrg()
  const s = summary.data

  const rows: LedgerRow[] = s
    ? [
        { label: t('home.enquiries'), value: s.enquiries, to: '/leads' },
        {
          label: t('home.botReplies'),
          value: s.botReplies,
          hint:
            s.avgReplySeconds != null
              ? t('home.avgReply', { seconds: s.avgReplySeconds })
              : undefined,
        },
        { label: t('home.demosBooked'), value: s.demosBooked, to: '/leads?stage=demo_booked' },
        { label: t('home.admissions'), value: s.admissions, to: '/leads?stage=admitted' },
        {
          label: t('home.feesCollected'),
          value: s.feesCollectedPaise,
          kind: 'money',
          to: '/fees?tab=paid',
        },
      ]
    : []
  const title =
    range === 'today'
      ? t('home.ledger')
      : range === 'yesterday'
        ? t('home.ledgerYesterday')
        : t('home.ledgerWeek')

  return (
    <Page title={t('home.title')}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          {org.data && org.data.status === 'onboarding' && (
            <Card
              title={t('home.setupTitle')}
              description={t('home.setupBody')}
              actions={
                <Button asChild size="md">
                  <Link to="/onboarding">
                    <RocketLaunchIcon aria-hidden />
                    {t('home.setupAction')}
                  </Link>
                </Button>
              }
            />
          )}
          <SegmentedControl<Summary['range']>
            legend={t('home.rangeLabel')}
            value={range}
            onChange={setRange}
            options={(['today', 'yesterday', 'week'] as const).map((r) => ({
              value: r,
              label: t(`home.range.${r}`),
            }))}
          />
          {summary.isError ? (
            <p className="text-body text-danger-600">{t('common.loadError')}</p>
          ) : !s ? (
            <Skeleton className="h-72" />
          ) : (
            <LedgerCard
              title={title}
              date={formatLongDate(new Date(`${s.from}T12:00:00+05:30`), lang)}
              rows={rows}
              footer={
                <Link
                  to="/chat?filter=human"
                  className="flex min-h-11 items-center gap-2 text-body font-semibold text-madder-700"
                >
                  <ChatsCircleIcon className="size-5" weight="bold" aria-hidden />
                  {s.waitingChats
                    ? t('home.waiting', { count: s.waitingChats })
                    : t('home.noneWaiting')}
                </Link>
              }
            />
          )}
          {s && s.unansweredCount > 0 && (
            <Link
              to="/knowledge?tab=unanswered"
              className="flex min-h-12 items-center gap-3 rounded-card border border-rule bg-surface px-4 text-body text-ink transition-colors duration-150 hover:border-ink-muted/60"
            >
              <ChalkboardTeacherIcon
                className="size-6 shrink-0 text-marigold-500"
                weight="duotone"
                aria-hidden
              />
              {t('home.teach', { count: s.unansweredCount })}
            </Link>
          )}
        </div>
        <div className="flex flex-col gap-4">
          <DemosToday summary={s} range={range} />
          <FeesDue summary={s} />
        </div>
      </div>
    </Page>
  )
}

function DemosToday({ summary, range }: { summary?: Summary; range: Summary['range'] }) {
  const { t } = useTranslation()
  const lang = usePreferences((s) => s.language)
  const mark = useCrmMutation(crm.markDemo)
  return (
    <Card title={range === 'yesterday' ? t('home.demosYesterday') : t('home.demosToday')}>
      {!summary ? (
        <Skeleton className="h-24" />
      ) : !summary.demos.length ? (
        <p className="text-body text-ink-muted">{t('home.noDemos')}</p>
      ) : (
        <ul className="-mx-4 divide-y divide-rule sm:-mx-5">
          {summary.demos.map((d) => {
            const marked = d.status === 'attended' || d.status === 'no_show'
            return (
              <li key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
                <span className="w-16 shrink-0 text-body font-semibold text-ink tabular">
                  {clock(d.startsAt, lang)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body text-ink">{d.studentName}</span>
                  <span className="block truncate text-small text-ink-muted">
                    {[d.courseName, d.batchName].filter(Boolean).join(' · ')}
                  </span>
                </span>
                {marked ? (
                  <StatusPill tone={d.status === 'attended' ? 'success' : 'neutral'}>
                    {t(`demo.status.${d.status}`)}
                  </StatusPill>
                ) : (
                  <span className="flex gap-2">
                    <Button
                      size="md"
                      variant="secondary"
                      loading={
                        mark.isPending &&
                        mark.variables?.id === d.id &&
                        mark.variables.status === 'attended'
                      }
                      onClick={() => mark.mutate({ id: d.id, status: 'attended' })}
                    >
                      {t('home.came')}
                    </Button>
                    <Button
                      size="md"
                      variant="ghost"
                      onClick={() => mark.mutate({ id: d.id, status: 'no_show' })}
                    >
                      {t('home.didntCome')}
                    </Button>
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

function FeesDue({ summary }: { summary?: Summary }) {
  const { t } = useTranslation()
  const lang = usePreferences((s) => s.language)
  const remind = useCrmMutation(crm.remind)
  return (
    <Card title={t('home.feesDue')}>
      {!summary ? (
        <Skeleton className="h-24" />
      ) : !summary.feesDue.length ? (
        <p className="text-body text-ink-muted">{t('home.noFeesDue')}</p>
      ) : (
        <ul className="-mx-4 divide-y divide-rule sm:-mx-5">
          {summary.feesDue.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body text-ink">{f.studentName}</span>
                <span className="block truncate text-small text-ink-muted">
                  {[f.courseName, f.label, feeDate(f.dueDate, lang)].filter(Boolean).join(' · ')}
                </span>
              </span>
              <span className="text-body font-semibold text-ink tabular">
                {formatPaise(f.amountPaise)}
              </span>
              <StatusPill tone={FEE_TONE[f.status]}>{t(`fees.status.${f.status}`)}</StatusPill>
              <Button
                size="md"
                variant="secondary"
                loading={remind.isPending && remind.variables === f.id}
                onClick={() =>
                  remind.mutate(f.id, {
                    onSuccess: (r) =>
                      toast(
                        r.sent
                          ? { title: t('home.reminderSent'), tone: 'success' }
                          : {
                              title: t(`fees.notSent.${r.reason}`, {
                                defaultValue: t('common.failed'),
                              }),
                              tone: 'danger',
                            },
                      ),
                    onError: (err) =>
                      toast({ title: errorText(err, t('common.failed')), tone: 'danger' }),
                  })
                }
              >
                {t('home.sendReminder')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
