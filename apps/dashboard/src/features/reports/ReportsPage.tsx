import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Page } from '@/app/Page'
import { SegmentedControl } from '@/components/SegmentedControl'
import { Skeleton } from '@/components/Skeleton'
import { formatCount, formatPaise } from '@/lib/format'
import { useReport, type Report } from '@/lib/growth'
import { usePreferences } from '@/lib/preferences'
import { ChartCard, DayColumns, HBars, HourHeatmap } from './charts'

type Days = Report['days']

/**
 * Reports (spec §16.12): the last 7, 30 or 90 days. Tiles first (the answer),
 * then the charts that explain it, then what WhatsApp cost.
 */
export default function ReportsPage() {
  const { t } = useTranslation()
  const lang = usePreferences((s) => s.language)
  const [days, setDays] = useState<Days>(30)
  const report = useReport(days)
  const locale = lang === 'hi' ? 'hi-IN' : 'en-IN'
  const dayLabel = (day: string) =>
    new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
      new Date(`${day}T00:00:00Z`),
    )
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(
      new Date(Date.UTC(2026, 0, 5 + i)), // 5 Jan 2026 is a Monday
    ),
  )

  return (
    <Page title={t('reports.title')}>
      <SegmentedControl
        legend={t('reports.range')}
        value={String(days) as '7' | '30' | '90'}
        onChange={(v) => setDays(Number(v) as Days)}
        options={(['7', '30', '90'] as const).map((v) => ({
          value: v,
          label: t('reports.days', { count: Number(v) }),
        }))}
        className="max-w-md"
      />

      {report.isError ? (
        <p className="mt-5 text-body text-danger-600">{t('common.loadError')}</p>
      ) : report.isPending ? (
        <div className="mt-5 grid gap-3 sm:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : (
        <Body report={report.data} dayLabel={dayLabel} weekdays={weekdays} />
      )}
    </Page>
  )
}

function Body({
  report: r,
  dayLabel,
  weekdays,
}: {
  report: Report
  dayLabel(day: string): string
  weekdays: string[]
}) {
  const { t } = useTranslation()
  const pct = (n: number) =>
    r.funnel.enquiries ? `${Math.round((n / r.funnel.enquiries) * 100)}%` : ''
  const tiles: { key: string; value: string; note?: string }[] = [
    { key: 'enquiries', value: formatCount(r.tiles.enquiries) },
    {
      key: 'firstReply',
      value:
        r.tiles.medianFirstReplySeconds == null
          ? '—'
          : r.tiles.medianFirstReplySeconds < 120
            ? t('reports.seconds', { count: r.tiles.medianFirstReplySeconds })
            : t('reports.minutes', { count: Math.round(r.tiles.medianFirstReplySeconds / 60) }),
    },
    { key: 'demos', value: formatCount(r.tiles.demosBooked) },
    { key: 'admissions', value: formatCount(r.tiles.admissions) },
    {
      key: 'conversion',
      value: r.tiles.conversionPercent == null ? '—' : `${r.tiles.conversionPercent}%`,
    },
    { key: 'fees', value: formatPaise(r.tiles.feesCollectedPaise) },
    {
      key: 'cost',
      value: formatPaise(r.tiles.messageCostPaise),
      note: t('reports.plusGst', { gst: formatPaise(r.tiles.messageGstPaise) }),
    },
  ]

  return (
    <div className="mt-5 flex flex-col gap-5">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((x) => (
          <div key={x.key} className="rounded-card border border-rule bg-surface p-4">
            <dt className="text-small text-ink-muted">{t(`reports.tiles.${x.key}`)}</dt>
            <dd className="mt-1 font-display text-h1 text-ink">{x.value}</dd>
            {x.note && <dd className="text-small text-ink-muted">{x.note}</dd>}
          </div>
        ))}
      </dl>

      <ChartCard
        title={t('reports.perDay')}
        table={{
          head: [t('reports.day'), t('reports.tiles.enquiries')],
          rows: r.enquiriesPerDay.map((d) => [dayLabel(d.day), d.n]),
        }}
      >
        <DayColumns data={r.enquiriesPerDay} label={t('reports.perDay')} dayLabel={dayLabel} />
      </ChartCard>

      <div className="grid gap-5 lg:grid-cols-2">
        <ChartCard
          title={t('reports.funnel')}
          description={t('reports.funnelHelp')}
          table={{
            head: [t('reports.step'), t('reports.people')],
            rows: [
              [t('reports.funnelSteps.enquiries'), r.funnel.enquiries],
              [t('reports.funnelSteps.demos'), r.funnel.demos],
              [t('reports.funnelSteps.admitted'), r.funnel.admitted],
            ],
          }}
        >
          <HBars
            rows={[
              { label: t('reports.funnelSteps.enquiries'), value: r.funnel.enquiries },
              {
                label: t('reports.funnelSteps.demos'),
                value: r.funnel.demos,
                note: pct(r.funnel.demos),
              },
              {
                label: t('reports.funnelSteps.admitted'),
                value: r.funnel.admitted,
                note: pct(r.funnel.admitted),
              },
            ]}
          />
          {r.funnel.fromCampaigns > 0 && (
            <p className="mt-3 text-small text-ink-muted">
              {t('reports.fromCampaigns', { count: r.funnel.fromCampaigns })}
            </p>
          )}
        </ChartCard>

        <ChartCard
          title={t('reports.sources')}
          description={t('reports.sourcesHelp')}
          table={{
            head: [
              t('reports.source'),
              t('reports.tiles.enquiries'),
              t('reports.tiles.admissions'),
            ],
            rows: r.sources.map((s) => [t(`sources.${s.source}`), s.n, s.admitted]),
          }}
        >
          {r.sources.length ? (
            <HBars
              rows={r.sources.map((s) => ({
                label: t(`sources.${s.source}`),
                value: s.n,
                note: t('reports.sourceAdmitted', { count: s.admitted }),
              }))}
            />
          ) : (
            <p className="text-small text-ink-muted">{t('reports.noData')}</p>
          )}
        </ChartCard>

        <ChartCard
          title={t('reports.topCourses')}
          table={{
            head: [t('reports.course'), t('reports.tiles.enquiries')],
            rows: r.topCourses.map((c) => [c.course, c.n]),
          }}
        >
          {r.topCourses.length ? (
            <HBars rows={r.topCourses.map((c) => ({ label: c.course, value: c.n }))} />
          ) : (
            <p className="text-small text-ink-muted">{t('reports.noData')}</p>
          )}
        </ChartCard>
      </div>

      <ChartCard
        title={t('reports.busiest')}
        description={t('reports.busiestHelp')}
        table={{
          head: [t('reports.day'), t('reports.hour'), t('reports.messages')],
          rows: [...r.heatmap]
            .sort((a, b) => b.n - a.n)
            .map((c) => [weekdays[c.weekday - 1]!, `${String(c.hour).padStart(2, '0')}:00`, c.n]),
        }}
      >
        <HourHeatmap cells={r.heatmap} weekdays={weekdays} label={t('reports.busiest')} />
      </ChartCard>

      <section className="rounded-card border border-rule bg-surface p-4">
        <h2 className="text-h3 text-ink">{t('reports.costTable')}</h2>
        <p className="text-small text-ink-muted">{t('reports.costHelp')}</p>
        {r.costs.length ? (
          <table className="mt-3 w-full text-left text-body">
            <thead className="text-small text-ink-muted">
              <tr>
                <th className="py-1 pr-3 font-semibold">{t('reports.category')}</th>
                <th className="py-1 pr-3 text-right font-semibold">{t('reports.sent')}</th>
                <th className="py-1 pr-3 text-right font-semibold">{t('reports.charged')}</th>
                <th className="py-1 text-right font-semibold">{t('reports.amount')}</th>
              </tr>
            </thead>
            <tbody className="text-ink">
              {r.costs.map((c) => (
                <tr key={c.category} className="border-t border-rule">
                  <td className="py-2 pr-3">{t(`reports.categories.${c.category}`)}</td>
                  <td className="py-2 pr-3 text-right tabular">{formatCount(c.sent)}</td>
                  <td className="py-2 pr-3 text-right tabular">{formatCount(c.billable)}</td>
                  <td className="py-2 text-right tabular">{formatPaise(c.costPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mt-3 text-small text-ink-muted">{t('reports.noData')}</p>
        )}
      </section>
    </div>
  )
}
