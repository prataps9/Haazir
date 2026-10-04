import { SectionLabel } from './Brand'
import Reveal from './Reveal'

/**
 * Three steps on one line of time. The paragraphs are the point, so the only
 * additions are the number badges and a "when" for each step.
 */
const STEPS = [
  {
    n: '1',
    when: 'Day one',
    title: 'We sit with you for an afternoon',
    body: 'We read three months of your real WhatsApp history — the repeat questions, the way your staff says no, the phrases customers actually use. That transcript is the spec. Nothing gets invented in a workshop.',
  },
  {
    n: '2',
    when: 'Within a week',
    title: 'We build it and you break it',
    body: 'Within a week there is a working agent on a test number. You message it like a difficult customer and reject every reply that does not sound like you. We rewrite until you stop finding them.',
  },
  {
    n: '3',
    when: 'About three weeks',
    title: 'It goes live and you see the numbers',
    body: 'We handle business verification and template approvals with Meta, then move it onto your real number. Each month you get a one-page report: enquiries answered, bookings made, threads handed over.',
  },
]

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="border-t border-line bg-paper py-20 sm:py-28">
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <Reveal className="max-w-[46rem]">
          <SectionLabel>How it works</SectionLabel>
          <h2 className="max-w-[20ch] text-[clamp(2rem,4.6vw,3.2rem)]">
            Three weeks, and nobody learns new software.
          </h2>
          <p className="mt-5 max-w-[46ch] text-[1.05rem] text-ink/70">
            You keep the same number, the same team, the same way of speaking to customers.
            We do the part that takes an engineer.
          </p>
        </Reveal>

        <ol className="relative mt-14 grid gap-10 md:grid-cols-3 md:gap-8">
          {/* The line the numbers sit on, desktop only. */}
          <div
            className="pointer-events-none absolute top-5 right-[16.67%] left-5 hidden h-px bg-line md:block"
            aria-hidden="true"
          />

          {STEPS.map((step, i) => (
            <Reveal as="li" key={step.n} delay={i * 80} className="relative">
              <span className="relative flex h-10 w-10 items-center justify-center rounded-full bg-clay-deep text-[1rem] font-semibold text-white ring-8 ring-paper">
                {step.n}
              </span>
              <p className="mt-5 inline-block rounded-full bg-white px-3 py-1 text-[0.82rem] font-medium text-ink/70 ring-1 ring-line">
                {step.when}
              </p>
              <h3 className="mt-4 text-[1.4rem]">{step.title}</h3>
              <p className="mt-3 text-[0.98rem] text-ink/70">{step.body}</p>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  )
}
