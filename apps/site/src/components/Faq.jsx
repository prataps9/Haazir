import { Plus } from 'lucide-react'
import { PrimaryCTA, SectionLabel } from './Brand'
import Reveal from './Reveal'

/**
 * The questions that otherwise cost a round-trip each in a DM. Native
 * <details> — no JS, keyboard-accessible, open on first paint if JS fails.
 */
const QUESTIONS = [
  {
    q: 'Do I have to change my number?',
    a: "No — you keep the number your customers already know. What changes is how your team reads it: the number moves onto the official platform, so it stops working through the WhatsApp Business app on a handset, and your staff reply from a shared inbox on any device instead. We do the migration with you.",
  },
  {
    q: 'What if it says something wrong, or promises a discount?',
    a: "It only answers from what you approved. During the build week you message it like a difficult customer and reject every reply that doesn't sound like you — we rewrite until you stop finding them. Anything it hasn't been taught, and anything that turns into negotiation or a complaint, goes to a human mid-sentence.",
  },
  {
    q: 'Will customers realise it is not a person?',
    a: "We don't pretend otherwise, and we don't give it a fake human name. It answers as your business. In practice people care that they got a straight answer at 11pm — and the moment they need a person, they get one.",
  },
  {
    q: 'What happens to my counter staff?',
    a: 'They stop retyping the same twenty answers and start getting only the threads that actually need them. Nobody learns new software: the handover lands in the same shared inbox they already use.',
  },
  {
    q: 'How long before it is live?',
    a: 'About three weeks. An afternoon with you, a working agent on a test number inside a week, then business verification and template approvals with Meta — that last part runs on Meta’s timeline, not ours, so it is the step that can stretch.',
  },
  {
    q: 'Does it work in Hindi?',
    a: 'Hindi, English and Hinglish, out of the box. It replies in whatever script the customer wrote in, and switches mid-conversation without being asked.',
  },
]

export default function Faq() {
  return (
    <section id="faq" className="border-t border-line bg-paper py-20 sm:py-28">
      <div className="mx-auto grid max-w-[1180px] gap-10 px-5 sm:px-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
        <Reveal className="lg:sticky lg:top-28 lg:self-start">
          <SectionLabel>Straight answers</SectionLabel>
          <h2 className="max-w-[16ch] text-[clamp(2rem,4.6vw,3.2rem)]">
            The things everyone asks before they say yes.
          </h2>
          <p className="mt-5 max-w-[34ch] text-ink/70">Something not here? Ask us on WhatsApp — a person answers.</p>
          <div className="mt-6">
            <PrimaryCTA context="nav">Ask us directly</PrimaryCTA>
          </div>
        </Reveal>

        <div className="flex flex-col gap-3">
          {QUESTIONS.map(({ q, a }) => (
            <details key={q} className="group rounded-2xl border border-line bg-white card open:border-ink/20">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-6 rounded-2xl px-6 py-5 text-[1.05rem] font-medium text-ink [&::-webkit-details-marker]:hidden">
                {q}
                <Plus
                  className="mt-1 h-4 w-4 shrink-0 text-clay-deep transition-transform duration-200 group-open:rotate-45"
                  strokeWidth={2}
                  aria-hidden="true"
                />
              </summary>
              <p className="max-w-[60ch] px-6 pb-6 text-[0.98rem] text-ink/70">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}
