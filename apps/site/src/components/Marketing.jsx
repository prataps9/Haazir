import { Bell, ChartColumn, Megaphone, ShieldCheck, UsersRound, Wallet } from 'lucide-react'
import { SEGMENT } from '../lib/campaign'

/**
 * The second half of the product: what happens after the reply. Everything
 * listed here is something the dashboard does today; add a line only when the
 * feature has shipped.
 *
 * The picture on the left is a campaign before and after it is sent, because
 * the two things an owner asks are "what will this cost me" and "did anyone
 * answer".
 */
const FEATURES = [
  {
    icon: UsersRound,
    title: 'Every enquiry becomes a lead',
    body: 'Name, number and what they asked for, saved the moment they message. Your team moves each one from new to booked to won on one board.',
  },
  {
    icon: Bell,
    title: 'Reminders and follow-ups go out on their own',
    body: 'A confirmation when someone books, a reminder before the visit, and a follow-up the next day if they came but did not decide.',
  },
  {
    icon: Megaphone,
    title: 'Campaigns to the people who said yes',
    body: 'Pick who gets it by tag or by stage, see the count and the cost before you send, and schedule it. Only people who agreed to hear from you are included.',
  },
  {
    icon: Wallet,
    title: 'Payment links and receipts',
    body: 'Dues are reminded before and after the date with a link to pay. The receipt goes back on WhatsApp when the money arrives.',
  },
  {
    icon: ChartColumn,
    title: 'Numbers you can read in a minute',
    body: 'Enquiries, bookings, sales and message cost by day, plus a short summary on your own WhatsApp every evening at 8.',
  },
  {
    icon: ShieldCheck,
    title: 'It stops when asked',
    body: 'Anyone who replies STOP is never messaged again, and nothing promotional goes out between 9 at night and 8 in the morning.',
  },
]

export default function Marketing() {
  return (
    <section id="marketing" className="border-t border-line bg-white py-20 sm:py-28">
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <h2 className="max-w-[20ch] text-[clamp(2rem,4.6vw,3.2rem)]">
          Then it brings them back. That is the marketing half.
        </h2>
        <p className="mt-5 max-w-[52ch] text-[1.05rem] text-ink/70">{SEGMENT.marketing}</p>

        <div className="mt-12 grid gap-10 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] lg:gap-16">
          <div className="rounded-[1.5rem] bg-stone p-5 sm:p-7 lg:self-start">
            <CampaignVisual />
          </div>

          <ul className="grid gap-x-10 gap-y-9 sm:grid-cols-2">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <li key={title}>
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-clay/10 text-clay-deep">
                  <Icon className="h-[1.15rem] w-[1.15rem]" strokeWidth={1.8} />
                </span>
                <h3 className="mt-4 text-[1.2rem]">{title}</h3>
                <p className="mt-2.5 text-[0.96rem] text-ink/70">{body}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

/* A campaign before sending and after. Example figures, decorative. */
function CampaignVisual() {
  const results = [
    { label: 'Sent', value: '212' },
    { label: 'Read', value: '168' },
    { label: 'Replied', value: '31' },
  ]
  return (
    <div className="flex flex-col gap-3" aria-hidden="true">
      <div className="rounded-2xl bg-white p-4 shadow-[0_1px_2px_rgb(14_16_19_/_0.06),0_12px_24px_-16px_rgb(14_16_19_/_0.2)]">
        <p className="text-[0.78rem] font-medium text-ink/65">Before you send</p>
        <p className="mt-2 text-[0.95rem] text-ink">New season offer</p>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-[0.82rem]">
          <div className="rounded-lg bg-paper px-3 py-2 ring-1 ring-line">
            <dt className="text-ink/65">Will receive it</dt>
            <dd className="mt-0.5 text-[1.05rem] font-semibold text-ink">212 people</dd>
          </div>
          <div className="rounded-lg bg-paper px-3 py-2 ring-1 ring-line">
            <dt className="text-ink/65">Left out</dt>
            <dd className="mt-0.5 text-[1.05rem] font-semibold text-ink">14 opted out</dd>
          </div>
        </dl>
        <p className="mt-2 rounded-lg bg-mint px-3 py-2 text-[0.82rem] text-ink">
          Meta's charge is shown here, with GST, before anything goes out.
        </p>
      </div>

      <div className="rounded-2xl bg-forest p-4 text-paper">
        <p className="text-[0.78rem] font-medium text-paper/75">After</p>
        <dl className="mt-2 grid grid-cols-3 gap-2">
          {results.map(({ label, value }) => (
            <div key={label}>
              <dd className="text-[1.5rem] leading-none font-semibold tracking-[-0.03em]">{value}</dd>
              <dt className="mt-1.5 text-[0.8rem] text-paper/75">{label}</dt>
            </div>
          ))}
        </dl>
      </div>
      <p className="text-center text-[0.78rem] text-ink/65">Example figures.</p>
    </div>
  )
}
