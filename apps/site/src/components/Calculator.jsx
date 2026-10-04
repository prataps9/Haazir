import { useEffect, useState } from 'react'
import { Check, Link2, MoonStar } from 'lucide-react'
import { JharokhaArch, PrimaryCTA, SectionLabel } from './Brand'
import Reveal from './Reveal'
import { groupIndian, indianShort, rupees } from '../lib/format'
import { useAnimatedNumber } from '../lib/hooks'
import { SEGMENT } from '../lib/campaign'

const AFTER_HOURS_SHARE = 0.34
const RECOVERY_RATE = 0.12
const DAYS = 30

const ENQUIRIES = { min: 5, max: 200, step: 1 }
const TICKET = { min: 1_000, max: 5_00_000, step: 1_000 }

const clamp = (n, { min, max }) => Math.min(max, Math.max(min, n))

/** Sliders start from the URL if it carries numbers, else from the segment's defaults. */
function startingValues() {
  const fallback = SEGMENT.calculator
  if (typeof window === 'undefined') return fallback

  const params = new URLSearchParams(window.location.search)
  const e = Number(params.get('e'))
  const t = Number(params.get('t'))

  return {
    enquiries: Number.isFinite(e) && e > 0 ? clamp(Math.round(e), ENQUIRIES) : fallback.enquiries,
    ticket: Number.isFinite(t) && t > 0 ? clamp(Math.round(t), TICKET) : fallback.ticket,
  }
}

export default function Calculator() {
  const [{ enquiries, ticket }, setValues] = useState(startingValues)
  // Only start writing to the address bar once someone has actually moved a
  // slider, so a clean outreach link stays clean until it carries real numbers.
  const [touched, setTouched] = useState(
    () => typeof window !== 'undefined' && /[?&][et]=/.test(window.location.search),
  )

  const set = (key) => (v) => {
    setTouched(true)
    setValues((s) => ({ ...s, [key]: v }))
  }

  const afterHours = enquiries * AFTER_HOURS_SHARE * DAYS
  const recoverable = afterHours * RECOVERY_RATE
  const value = recoverable * ticket

  const animatedAfterHours = useAnimatedNumber(afterHours)
  const animatedRecoverable = useAnimatedNumber(recoverable)
  const animatedValue = useAnimatedNumber(value)

  const short = indianShort(animatedValue)

  // Keep the address bar in step, so the link in your hand always carries
  // whatever numbers are on screen. replaceState — no history spam while dragging.
  useEffect(() => {
    if (!touched) return
    const url = new URL(window.location.href)
    url.searchParams.set('e', String(enquiries))
    url.searchParams.set('t', String(ticket))
    window.history.replaceState(null, '', url)
  }, [enquiries, ticket, touched])

  return (
    <section id="calculator" className="border-t border-line bg-white py-20 sm:py-28">
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <Reveal>
          <SectionLabel>The cost of silence</SectionLabel>
          <h2 className="max-w-[18ch] text-[clamp(2rem,4.6vw,3.2rem)]">
            Move two sliders. See the year you're giving away.
          </h2>
        </Reveal>

        <div className="mt-12 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)] lg:gap-16">
          {/* Inputs */}
          <div>
            <Slider
              id="enquiries"
              label="Enquiries you get in a day"
              value={enquiries}
              {...ENQUIRIES}
              onChange={set('enquiries')}
              display={groupIndian(enquiries)}
              suffix="a day"
            />

            <Slider
              id="ticket"
              label="What an average customer is worth"
              value={ticket}
              {...TICKET}
              onChange={set('ticket')}
              display={rupees(ticket)}
              suffix="per customer"
              className="mt-10"
            />

            <p className="mt-10 max-w-[46ch] border-t border-line pt-6 text-[0.84rem] leading-relaxed text-ink/60">
              Assumptions: {Math.round(AFTER_HOURS_SHARE * 100)}% of enquiries arrive
              outside working hours, across {DAYS} days a month.{' '}
              {Math.round(RECOVERY_RATE * 100)}% of those become customers when they get
              an answer within a minute instead of the next morning. Your own numbers
              will differ — we'd rather read your actual WhatsApp history than guess.
            </p>

            <ShareButton enquiries={enquiries} ticket={ticket} />
          </div>

          {/* Results */}
          <div className="relative overflow-hidden rounded-[1.75rem] bg-forest p-7 text-paper shadow-[0_30px_60px_-34px_rgb(11_42_33_/_0.7)] sm:p-9">
            <JharokhaArch
              className="pointer-events-none absolute -right-8 -bottom-10 h-56 w-56 text-paper/[0.05]"
              aria-hidden="true"
            />

            <div className="relative" aria-live="polite">
              <p className="flex items-center gap-2.5 text-[0.9rem] font-medium text-paper/80">
                <MoonStar className="h-4 w-4 text-clay-soft" strokeWidth={1.8} />
                Every month, roughly
              </p>

              <dl className="mt-7 space-y-5">
                <Stat
                  term="Enquiries that land after hours"
                  value={groupIndian(animatedAfterHours)}
                  unit="messages"
                />
                <Stat
                  term="Customers you'd have kept"
                  value={groupIndian(animatedRecoverable)}
                  unit="people"
                />
              </dl>

              <div className="mt-8 border-t border-paper/15 pt-7">
                <dt className="text-[0.95rem] text-paper/80">Revenue walking away</dt>
                <dd className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-[clamp(2.8rem,7vw,4.2rem)] leading-none font-semibold tracking-[-0.045em] text-white">
                    &#8377;{short.value}
                  </span>
                  {short.unit && (
                    <span className="text-[1.4rem] font-medium tracking-[-0.03em] text-clay-soft">
                      {short.unit}
                    </span>
                  )}
                  <span className="w-full text-[0.9rem] text-paper/75">
                    {rupees(animatedValue)} a month &middot; {rupees(animatedValue * 12)} a year
                  </span>
                </dd>
              </div>

              {/* Highest-intent moment on the page — the figure rides into the chat. */}
              <PrimaryCTA
                context="calculator"
                extra={`${rupees(value)}`}
                tone="light"
                className="mt-8 w-full sm:w-auto"
              >
                Talk about this number
              </PrimaryCTA>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

/**
 * Copies a link that carries whatever is currently on the sliders — the point
 * being to send a prospect their own numbers, already dialled in.
 */
function ShareButton({ enquiries, ticket }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 2200)
    return () => clearTimeout(t)
  }, [copied])

  const copy = async () => {
    const url = new URL(window.location.href)
    url.searchParams.set('e', String(enquiries))
    url.searchParams.set('t', String(ticket))
    const link = url.toString()

    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
    } catch {
      // Clipboard blocked (insecure context, denied permission) — show the link
      // instead of failing silently, so it is still one keystroke away.
      window.prompt('Copy this link', link)
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="mt-6 inline-flex items-center gap-2 rounded-full border border-line bg-white px-4 py-2 text-[0.88rem] text-ink/70 transition-colors hover:border-ink/25 hover:text-ink"
    >
      {copied ? (
        <Check className="h-4 w-4 text-clay-deep" strokeWidth={2} />
      ) : (
        <Link2 className="h-4 w-4 text-clay-deep" strokeWidth={1.8} />
      )}
      {copied ? 'Link copied' : 'Copy link with these numbers'}
    </button>
  )
}

function Stat({ term, value, unit }) {
  return (
    <div className="flex flex-col gap-1 border-b border-paper/15 pb-5 last:border-0 last:pb-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <dt className="text-[0.95rem] text-paper/80">{term}</dt>
      <dd className="shrink-0 text-[1.65rem] font-semibold tracking-[-0.035em]">
        {value}
        <span className="ml-1.5 text-[0.85rem] font-normal tracking-normal text-paper/75">
          {unit}
        </span>
      </dd>
    </div>
  )
}

function Slider({ id, label, value, min, max, step, onChange, display, suffix, className = '' }) {
  return (
    <div className={className}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-[1.02rem] text-ink/80">
          {label}
        </label>
        <p className="text-[1.3rem] font-semibold tracking-[-0.035em]">
          {display}
          <span className="ml-1.5 text-[0.82rem] font-normal tracking-normal text-ink/60">
            {suffix}
          </span>
        </p>
      </div>

      <input
        id={id}
        type="range"
        className="haazir-range mt-2"
        style={{ '--fill': `${((value - min) / (max - min)) * 100}%` }}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />

      <div className="flex justify-between text-[0.78rem] text-ink/60">
        <span>{id === 'ticket' ? rupees(min) : groupIndian(min)}</span>
        <span>{id === 'ticket' ? rupees(max) : groupIndian(max)}</span>
      </div>
    </div>
  )
}
