import { SEGMENTS } from '../lib/segments'
import { SEGMENT } from '../lib/campaign'

/**
 * One line naming who this is built for — customer segments, never client
 * logos. On a segment page the reader's own trade is marked, so a jeweller sees
 * themselves named rather than hunting for it.
 */
export default function SegmentBar() {
  return (
    <section className="border-y border-line bg-white" aria-label="Who haazir is built for">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-x-6 gap-y-3 px-5 py-6 sm:px-8 md:flex-row md:items-center">
        <p className="shrink-0 text-[0.9rem] font-medium text-ink/70">Built for</p>
        <ul className="flex flex-wrap items-center gap-2">
          {SEGMENTS.map((segment) => {
            const current = segment.slug === SEGMENT.slug
            return (
              <li
                key={segment.slug}
                aria-current={current ? 'true' : undefined}
                className={`rounded-full border px-4 py-1.5 text-[0.92rem] ${
                  current
                    ? 'border-clay-deep bg-clay-deep text-white'
                    : 'border-line bg-paper text-ink/75'
                }`}
              >
                {segment.name.charAt(0).toUpperCase() + segment.name.slice(1)}
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
