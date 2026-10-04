import { ArrowDown, Check } from 'lucide-react'
import { GhostCTA, PrimaryCTA } from './Brand'
import Thread from './Thread'
import { SEGMENT } from '../lib/campaign'

const PROOF = [
  'Official WhatsApp Business Platform',
  'Hindi, English and Hinglish',
  'Live in about three weeks',
]

/**
 * The demo is the hero: the exchange plays the moment you land, inside a phone,
 * so the most persuasive thing on the page is the first thing on it.
 *
 * On a phone the blocks run headline → thread → buttons: proof before the ask.
 * On a desktop the text stacks in column one and the thread sits beside it,
 * which is why the placement is explicit rather than two nested columns.
 */
export default function Hero() {
  return (
    <section id="top" className="relative overflow-hidden bg-paper">
      {/* 68px grid, radially masked so it fades at the edges */}
      <div className="pointer-events-none absolute inset-0 grid-bg grid-mask-hero" aria-hidden="true" />
      <div
        className="pointer-events-none absolute -top-48 -left-40 h-[34rem] w-[34rem] rounded-full bg-clay/12 blur-[130px]"
        aria-hidden="true"
      />

      <div className="relative mx-auto max-w-[1180px] px-5 pt-6 pb-16 sm:px-8 lg:pt-12 lg:pb-24">
        <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,0.72fr)] lg:gap-14">
          <div className="lg:col-start-1 lg:row-start-1 lg:self-end">
            <p className="inline-flex items-center gap-2.5 rounded-full border border-line bg-white py-1.5 pr-4 pl-3 text-[0.82rem] font-medium text-ink/75 card">
              <span className="relative flex h-2 w-2 shrink-0 items-center justify-center">
                <span className="animate-ring absolute h-2 w-2 rounded-full bg-[#16a34a]" aria-hidden="true" />
                <span className="animate-dot h-2 w-2 rounded-full bg-[#16a34a]" />
              </span>
              WhatsApp AI agents, built in Jaipur
            </p>

            <h1 className="mt-6 text-[clamp(2.7rem,7.2vw,5rem)] leading-[0.96]">
              Someone is <span className="text-clay">always</span> at the window.
            </h1>

            {SEGMENT.eyebrow && (
              <p className="mt-5 text-[1rem] font-medium text-clay-deep">{SEGMENT.eyebrow}</p>
            )}

            <p className="mt-5 max-w-[35rem] text-[1.125rem] text-ink/70">{SEGMENT.subhead}</p>
          </div>

          {/* The thread itself — this is the pitch, not decoration beside it. */}
          <div className="relative mx-auto w-full max-w-[22.5rem] lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:max-w-none lg:self-center">
            <div
              className="pointer-events-none absolute -inset-x-4 inset-y-10 -z-0 rounded-[2.5rem] bg-stone"
              aria-hidden="true"
            />
            <Thread {...SEGMENT.thread} className="relative" />
          </div>

          <div className="lg:col-start-1 lg:row-start-2 lg:self-start">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <PrimaryCTA className="px-7 py-4">Send us a WhatsApp</PrimaryCTA>
              <GhostCTA href="#calculator" className="px-7 py-4">
                See what silence costs
                <ArrowDown className="h-4 w-4" strokeWidth={1.75} />
              </GhostCTA>
            </div>

            <ul className="mt-8 flex flex-col gap-x-6 gap-y-2.5 text-[0.92rem] text-ink/70 sm:flex-row sm:flex-wrap">
              {PROOF.map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <Check className="h-4 w-4 shrink-0 text-clay-deep" strokeWidth={2.4} />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  )
}
