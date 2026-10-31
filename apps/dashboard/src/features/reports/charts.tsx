import { useId, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'
import { formatCount } from '@/lib/format'

/**
 * Small, hand-drawn charts in the bahi-khata tokens (no chart library: the
 * Reports chunk stays small). One series each, so one colour: madder. Text
 * stays in ink; every chart has a hover/focus readout and a table view.
 */

/** Clean y-axis top: 0 / 5 / 10 / 20 / 50 / 100… */
function niceMax(max: number) {
  if (max <= 4) return 4
  const pow = 10 ** Math.floor(Math.log10(max))
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= max) return m * pow
  return 10 * pow
}

export function ChartCard({
  title,
  description,
  table,
  children,
}: {
  title: string
  description?: string
  /** The same numbers as a table, for screen readers and anyone who prefers it. */
  table: { head: string[]; rows: (string | number)[][] }
  children: ReactNode
}) {
  const { t } = useTranslation()
  return (
    <section className="rounded-card border border-rule bg-surface p-4">
      <h2 className="text-h3 text-ink">{title}</h2>
      {description && <p className="text-small text-ink-muted">{description}</p>}
      <div className="mt-3">{children}</div>
      <details className="mt-2 text-small text-ink-muted">
        <summary className="flex min-h-11 cursor-pointer items-center">
          {t('reports.showTable')}
        </summary>
        <div className="max-h-64 overflow-auto">
          <table className="w-full text-left text-small text-ink">
            <thead>
              <tr>
                {table.head.map((h) => (
                  <th key={h} className="border-b border-rule py-1 pr-3 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j} className="border-b border-rule py-1 pr-3 tabular">
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  )
}

/**
 * Columns over days: ≤ 24px wide, rounded at the top, square on the
 * baseline; hairline grid. Built in HTML so labels keep their real size on a
 * phone. Hover, tap or arrow keys read out one day.
 */
export function DayColumns({
  data,
  label,
  dayLabel,
}: {
  data: { day: string; n: number }[]
  label: string
  dayLabel(day: string): string
}) {
  const { t } = useTranslation()
  const [active, setActive] = useState<number | null>(null)
  const max = niceMax(Math.max(0, ...data.map((d) => d.n)))
  const current = active == null ? null : data[active]
  const ticks = [max, max / 2, 0]
  const labelAt = new Set(
    data.length <= 7 ? data.map((_, i) => i) : [0, Math.floor(data.length / 2), data.length - 1],
  )

  return (
    <div>
      <p className="mb-1 min-h-6 text-small text-ink" aria-live="polite">
        {current ? t('reports.dayReadout', { day: dayLabel(current.day), count: current.n }) : ''}
      </p>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2">
        <div
          className="flex h-44 flex-col justify-between text-right text-small text-ink-muted tabular"
          aria-hidden
        >
          {ticks.map((v) => (
            <span key={v} className="-my-2.5 leading-5">
              {formatCount(v)}
            </span>
          ))}
        </div>
        <div
          role="img"
          aria-label={label}
          tabIndex={0}
          className="relative h-44 rounded-[2px] outline-offset-2"
          onPointerLeave={() => setActive(null)}
          onBlur={() => setActive(null)}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
            e.preventDefault()
            setActive((i) =>
              i == null
                ? data.length - 1
                : Math.min(data.length - 1, Math.max(0, i + (e.key === 'ArrowRight' ? 1 : -1))),
            )
          }}
        >
          {ticks.map((v) => (
            <span
              key={v}
              className="absolute inset-x-0 h-px bg-rule"
              style={{ top: `${(1 - v / max) * 100}%` }}
              aria-hidden
            />
          ))}
          <div className="absolute inset-0 flex items-end gap-[2px]">
            {data.map((d, i) => (
              <div
                key={d.day}
                className={cn(
                  'flex h-full min-w-0 flex-1 items-end justify-center',
                  i === active && 'bg-ink/5',
                )}
                onPointerEnter={() => setActive(i)}
                onPointerDown={() => setActive(i)}
              >
                {d.n > 0 && (
                  <div
                    className="w-full max-w-6 rounded-t-[4px] bg-madder-600"
                    style={{ height: `${(d.n / max) * 100}%` }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
        <span />
        <div className="mt-1 flex text-small text-ink-muted" aria-hidden>
          {data.map((d, i) => (
            <span
              key={d.day}
              className={cn(
                'min-w-0 flex-1 overflow-visible whitespace-nowrap',
                data.length > 7 && i === 0 && 'text-left',
                data.length > 7 && i === data.length - 1 && 'flex justify-end',
                (data.length <= 7 || (i !== 0 && i !== data.length - 1)) && 'flex justify-center',
              )}
            >
              {labelAt.has(i) ? dayLabel(d.day) : ''}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Horizontal bars with the value at the tip (funnel, top courses). */
export function HBars({ rows }: { rows: { label: string; value: number; note?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="flex items-baseline justify-between gap-3 text-small">
            <span className="text-ink">{r.label}</span>
            <span className="text-ink tabular">
              <span className="font-semibold">{formatCount(r.value)}</span>
              {r.note && <span className="ml-1.5 text-ink-muted">{r.note}</span>}
            </span>
          </div>
          <div className="mt-1 h-3 w-full rounded-r-[4px] bg-ink/5" aria-hidden>
            <div
              className="h-3 rounded-r-[4px] bg-madder-600"
              style={{ width: `${(r.value / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

/** Five steps of madder over the surface: a one-hue sequential scale (light = few). */
const STEPS = [12, 30, 50, 72, 100]

/**
 * When people write (spec §16.12): weekday × hour, darker = busier. Each cell
 * reads out on hover or focus; the legend says which way is more.
 */
export function HourHeatmap({
  cells,
  weekdays,
  label,
}: {
  cells: { weekday: number; hour: number; n: number }[]
  weekdays: string[]
  label: string
}) {
  const { t } = useTranslation()
  const id = useId()
  const [active, setActive] = useState<{ weekday: number; hour: number; n: number } | null>(null)
  const max = Math.max(0, ...cells.map((c) => c.n))
  const at = (weekday: number, hour: number) =>
    cells.find((c) => c.weekday === weekday && c.hour === hour)?.n ?? 0
  const step = (n: number) =>
    n === 0 || max === 0
      ? null
      : STEPS[Math.min(STEPS.length - 1, Math.floor((n / max) * STEPS.length - 1e-9))]!

  return (
    <div>
      <p className="mb-1 min-h-6 text-small text-ink" aria-live="polite">
        {active
          ? t('reports.hourReadout', {
              day: weekdays[active.weekday - 1],
              hour: `${String(active.hour).padStart(2, '0')}:00`,
              count: active.n,
            })
          : ''}
      </p>
      <div className="overflow-x-auto">
        <table
          className="border-separate border-spacing-[2px]"
          aria-describedby={`${id}-legend`}
          aria-label={label}
          onPointerLeave={() => setActive(null)}
        >
          <thead>
            <tr>
              <th />
              {Array.from({ length: 24 }, (_, h) => (
                <th
                  key={h}
                  scope="col"
                  className="w-5 text-left text-small font-normal whitespace-nowrap text-ink-muted"
                >
                  {h % 6 === 0 ? h : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weekdays.map((d, w) => (
              <tr key={d}>
                <th scope="row" className="pr-2 text-left text-small font-normal text-ink-muted">
                  {d}
                </th>
                {Array.from({ length: 24 }, (_, h) => {
                  const n = at(w + 1, h)
                  const s = step(n)
                  return (
                    <td
                      key={h}
                      tabIndex={n ? 0 : -1}
                      onPointerEnter={() => setActive({ weekday: w + 1, hour: h, n })}
                      onFocus={() => setActive({ weekday: w + 1, hour: h, n })}
                      className="size-5 min-w-5 rounded-[3px] border border-rule/60"
                      style={
                        s
                          ? {
                              background: `color-mix(in oklab, var(--color-madder-600) ${s}%, var(--color-surface))`,
                              borderColor: 'transparent',
                            }
                          : undefined
                      }
                    >
                      <span className="sr-only">{n}</span>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p id={`${id}-legend`} className="mt-2 flex items-center gap-1.5 text-small text-ink-muted">
        {t('reports.fewer')}
        {STEPS.map((s) => (
          <span
            key={s}
            className="inline-block size-4 rounded-[3px]"
            style={{
              background: `color-mix(in oklab, var(--color-madder-600) ${s}%, var(--color-surface))`,
            }}
            aria-hidden
          />
        ))}
        {t('reports.more')}
      </p>
    </div>
  )
}
