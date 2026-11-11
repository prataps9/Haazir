import { Check } from 'lucide-react'
import { GhostCTA, PrimaryCTA } from './Brand'
import Thread from './Thread'
import { SEGMENT } from '../lib/campaign'

const PROOF = [
  'Answers enquiries day and night',
  'Follow-ups, reminders and campaigns',
  'Official WhatsApp Business Platform',
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
    <section id="top" className="bg-paper">
      <div className="relative mx-auto max-w-[1180px] px-5 pt-6 pb-16 sm:px-8 lg:pt-12 lg:pb-24">
        <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,0.72fr)] lg:gap-14">
          <div className="lg:col-start-1 lg:row-start-1 lg:self-end">
            <h1 className="text-[clamp(2.7rem,7.2vw,5rem)] leading-[0.96]">
              Someone is <span className="text-clay">always</span> at the window.
            </h1>

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
