import { CalendarCheck, Check, CheckCheck, Languages, ShieldCheck, UserRound } from 'lucide-react'
import { SectionLabel } from './Brand'
import Reveal from './Reveal'

/**
 * Three equal cards, each with a small picture of the thing it describes, so a
 * reader sees the product before they finish the sentence. The compliance
 * point is the strip underneath: a reassurance, not a fourth feature.
 */
const CARDS = [
  {
    icon: CalendarCheck,
    title: 'Books and confirms on its own',
    body: 'Your customer picks a slot inside the chat — no callback, no "we\'ll confirm tomorrow". It reads your live calendar, offers only what is free, and sends the reminder the day before.',
    visual: SlotsVisual,
  },
  {
    icon: Languages,
    title: 'Hindi, English, Hinglish',
    body: 'Nobody has to switch to English to be understood. Whatever script your customer types in, the reply comes back in the same one — and it switches mid-conversation without being asked.',
    visual: LanguagesVisual,
  },
  {
    icon: UserRound,
    title: 'Knows when to step back',
    body: 'Price negotiation, a complaint, anything it has not been taught — it hands the thread to a human mid-sentence and stays quiet.',
    visual: HandoverVisual,
  },
]

const SAFEGUARDS = [
  'Business verification',
  'Green tick application',
  'Template approvals',
  'Quality rating monitoring',
]

export default function WhatItDoes() {
  return (
    <section id="what-it-does" className="bg-paper py-20 sm:py-28">
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <Reveal>
          <SectionLabel>What your customer gets</SectionLabel>
          <h2 className="max-w-[20ch] text-[clamp(2rem,4.6vw,3.2rem)]">
            An answer in seconds, from someone who sounds like your shop.
          </h2>
        </Reveal>

        <div className="mt-12 grid gap-4 sm:gap-5 md:grid-cols-3">
          {CARDS.map(({ icon: Icon, title, body, visual: Visual }, i) => (
            <Reveal key={title} delay={i * 70}>
              <article className="flex h-full flex-col rounded-[1.5rem] border border-line bg-white p-3 card">
                <div className="flex h-44 items-center justify-center rounded-[1.1rem] bg-stone px-4">
                  <Visual />
                </div>
                <div className="px-3.5 pt-6 pb-4">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-clay/10 text-clay-deep">
                    <Icon className="h-[1.15rem] w-[1.15rem]" strokeWidth={1.8} />
                  </span>
                  <h3 className="mt-4 text-[1.4rem]">{title}</h3>
                  <p className="mt-3 text-[0.98rem] text-ink/70">{body}</p>
                </div>
              </article>
            </Reveal>
          ))}
        </div>

        {/* Compliance, as a strip rather than a whole tile. */}
        <Reveal delay={210} className="mt-4 sm:mt-5">
          <div className="rounded-[1.5rem] border border-line bg-white px-6 py-6 card sm:px-8">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:gap-12">
              <p className="flex items-start gap-4 lg:max-w-[30rem]">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-forest text-paper">
                  <ShieldCheck className="h-5 w-5" strokeWidth={1.7} />
                </span>
                <span className="text-[0.98rem] text-ink/75">
                  <strong className="font-semibold text-ink">Your number will not get banned.</strong>{' '}
                  We run on the official WhatsApp Business Platform, not a library signing in as
                  your phone. The compliance work is ours.
                </span>
              </p>

              <ul className="grid gap-x-8 gap-y-2.5 sm:grid-cols-2 lg:ml-auto lg:shrink-0">
                {SAFEGUARDS.map((item) => (
                  <li key={item} className="flex items-center gap-2.5 text-[0.92rem] text-ink/75">
                    <Check className="h-4 w-4 shrink-0 text-clay-deep" strokeWidth={2.4} />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

/* Small, static pictures of the product. Decorative: the paragraph says it all. */

function SlotsVisual() {
  const slots = ['10:30', '11:30', '4:00']
  return (
    <div className="w-full max-w-[15rem] rounded-2xl bg-white p-3.5 shadow-[0_1px_2px_rgb(14_16_19_/_0.06),0_12px_24px_-16px_rgb(14_16_19_/_0.2)]" aria-hidden="true">
      <p className="text-[0.78rem] font-medium text-ink/65">Saturday</p>
      <div className="mt-2 flex gap-1.5">
        {slots.map((slot, i) => (
          <span
            key={slot}
            className={`flex-1 rounded-lg py-1.5 text-center text-[0.82rem] font-medium ${
              i === 1 ? 'bg-forest text-paper' : 'bg-paper text-ink/70 ring-1 ring-line'
            }`}
          >
            {slot}
          </span>
        ))}
      </div>
      <p className="mt-3 flex items-center gap-1.5 rounded-lg bg-mint px-2.5 py-1.5 text-[0.78rem] text-ink">
        <CheckCheck className="h-3.5 w-3.5 text-tick" strokeWidth={2.2} />
        Booked. Reminder goes out Friday.
      </p>
    </div>
  )
}

function LanguagesVisual() {
  const lines = [
    { tag: 'हिं', text: 'क्या यह उपलब्ध है?', deva: true, mine: false },
    { tag: 'En', text: 'Yes, it is in stock.', mine: true },
    { tag: 'Hi', text: 'Haan, kal le aaiye.', mine: false },
  ]
  return (
    <div className="flex w-full max-w-[15rem] flex-col gap-1.5" aria-hidden="true">
      {lines.map(({ tag, text, deva, mine }) => (
        <p
          key={text}
          className={`flex w-fit items-center gap-2 rounded-xl px-2.5 py-1.5 text-[0.85rem] text-ink shadow-[0_1px_1px_rgb(14_16_19_/_0.08)] ${
            mine ? 'ml-auto bg-mint' : 'bg-white'
          } ${deva ? 'font-deva' : ''}`}
        >
          <span className="rounded bg-ink/8 px-1 text-[0.68rem] font-medium text-ink/70">{tag}</span>
          {text}
        </p>
      ))}
    </div>
  )
}

function HandoverVisual() {
  return (
    <div className="flex w-full max-w-[15rem] flex-col items-stretch gap-2.5" aria-hidden="true">
      <p className="w-fit rounded-xl bg-white px-2.5 py-1.5 text-[0.85rem] text-ink shadow-[0_1px_1px_rgb(14_16_19_/_0.08)]">
        Can you do it for less?
      </p>
      <p className="mx-auto flex items-center gap-2 rounded-full bg-white px-3 py-1 text-[0.76rem] text-ink/75 shadow-[0_1px_1px_rgb(14_16_19_/_0.08)]">
        <span className="h-1.5 w-1.5 rounded-full bg-clay" />
        Handed to your team
      </p>
      <p className="flex items-center justify-between rounded-xl bg-forest px-3 py-2 text-[0.8rem] text-paper">
        Agent paused
        <span className="rounded-full bg-paper/15 px-2 py-0.5 text-[0.72rem]">You have it</span>
      </p>
    </div>
  )
}
