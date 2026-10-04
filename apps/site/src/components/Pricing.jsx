import { Check } from 'lucide-react'
import { PrimaryCTA, SectionLabel } from './Brand'
import Reveal from './Reveal'

const PLANS = [
  {
    name: 'Build',
    price: '₹25,000',
    cadence: 'once',
    badge: 'Starts here',
    body: 'Reading your history, writing the agent, getting it through Meta verification and onto your number.',
    points: ['Discovery afternoon', 'Agent built to your transcript', 'Verification & template approvals'],
    featured: true,
  },
  {
    name: 'Run',
    price: '₹5,000',
    cadence: 'per month',
    body: 'Hosting, monitoring, and the edits you ask for as your catalogue, staff and prices change.',
    points: ['Uptime & quality monitoring', 'Unlimited copy edits', 'One-page monthly report'],
  },
  {
    name: 'Messages',
    price: 'At cost',
    cadence: 'passed through',
    body: 'Meta charges per conversation. We bill you exactly what they bill us, on the same invoice.',
    points: ["Meta's published rates", 'No markup, no minimum', 'Itemised every month'],
  },
]

/**
 * The comparison table used to be its own section: seven rows, 1,226px of phone
 * scrolling, and it had to scroll sideways to be read at all. It was answering
 * two objections, so it is now two short answers, sitting where the objections
 * actually surface — next to the price.
 */
const OBJECTIONS = [
  {
    q: 'Why not a cheap WhatsApp bot?',
    a: 'Most of them sign in as your phone, which is what gets numbers banned, and they answer from keyword scripts rather than from how your shop actually talks. They are cheap right up until the number goes.',
  },
  {
    q: 'Why not just hire someone?',
    a: 'A person is better than us at judgement and costs more than us at 11pm. Thirty enquiries at once is not a staffing problem you want to solve twice. Keep the person for the threads that need one — that is exactly what it hands over.',
  },
]

export default function Pricing() {
  return (
    <section id="pricing" className="border-t border-line bg-white py-20 sm:py-28">
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <Reveal>
          <SectionLabel>Pricing</SectionLabel>
          <h2 className="max-w-[18ch] text-[clamp(2rem,4.6vw,3.2rem)]">
            Two numbers and a pass-through.
          </h2>
        </Reveal>

        <div className="mt-12 grid gap-4 sm:gap-5 md:grid-cols-3">
          {PLANS.map((plan, i) => (
            <Reveal key={plan.name} delay={i * 70}>
              <article
                className={`relative flex h-full flex-col rounded-[1.5rem] border p-7 sm:p-8 ${
                  plan.featured
                    ? 'border-forest bg-forest text-paper shadow-[0_30px_60px_-34px_rgb(11_42_33_/_0.7)]'
                    : 'border-line bg-paper card'
                }`}
              >
                {plan.badge && (
                  <span className="absolute top-6 right-6 rounded-full bg-clay-deep px-3 py-1 text-[0.78rem] font-medium text-white">
                    {plan.badge}
                  </span>
                )}

                <h3
                  className={`text-[1.15rem] font-semibold tracking-[-0.02em] ${
                    plan.featured ? 'text-paper' : 'text-ink'
                  }`}
                >
                  {plan.name}
                </h3>

                <p className="mt-5 flex flex-wrap items-baseline gap-x-2">
                  <span className="text-[clamp(2.2rem,3.8vw,2.8rem)] leading-none font-semibold tracking-[-0.045em]">
                    {plan.price}
                  </span>
                  <span className={`text-[0.92rem] ${plan.featured ? 'text-paper/75' : 'text-ink/65'}`}>
                    {plan.cadence}
                  </span>
                </p>

                <p className={`mt-5 text-[0.96rem] ${plan.featured ? 'text-paper/85' : 'text-ink/70'}`}>
                  {plan.body}
                </p>

                <ul
                  className={`mt-6 space-y-2.5 border-t pt-6 text-[0.93rem] ${
                    plan.featured ? 'border-paper/15 text-paper/85' : 'border-line text-ink/70'
                  }`}
                >
                  {plan.points.map((point) => (
                    <li key={point} className="flex items-center gap-3">
                      <Check
                        className={`h-4 w-4 shrink-0 ${plan.featured ? 'text-clay-soft' : 'text-clay-deep'}`}
                        strokeWidth={2.4}
                      />
                      {point}
                    </li>
                  ))}
                </ul>
              </article>
            </Reveal>
          ))}
        </div>

        <Reveal delay={210} className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-4">
          <PrimaryCTA context="pricing">Ask what yours would cost</PrimaryCTA>
          <p className="text-[0.95rem] text-ink/65">
            No retainer lock-in. Cancel the monthly whenever you like.
          </p>
        </Reveal>

        <Reveal delay={90} className="mt-12 grid gap-4 border-t border-line pt-10 sm:gap-5 md:grid-cols-2">
          {OBJECTIONS.map(({ q, a }) => (
            <div key={q}>
              <h3 className="text-[1.2rem]">{q}</h3>
              <p className="mt-3 text-[0.95rem] text-ink/70">{a}</p>
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  )
}
