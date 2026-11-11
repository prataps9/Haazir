/**
 * How the two halves join up, as one line of six steps. It exists so a reader
 * who skimmed both sections still leaves knowing it is one system on one
 * number, not a chatbot plus a separate broadcast tool.
 */
const STEPS = [
  { title: 'Enquiry', body: 'Someone messages your number, at any hour.' },
  { title: 'Reply', body: 'The agent answers and books, or hands over.' },
  { title: 'Lead', body: 'They are saved with what they asked for.' },
  { title: 'Follow-up', body: 'Reminders go out before and after the visit.' },
  { title: 'Campaign', body: 'Your next offer reaches those who agreed.' },
  { title: 'Report', body: 'You see what came in and what it cost.' },
]

export default function Loop() {
  return (
    <section className="border-t border-line bg-paper py-16 sm:py-20" aria-labelledby="loop-title">
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <h2 id="loop-title" className="max-w-[24ch] text-[clamp(1.6rem,3.4vw,2.3rem)]">
          One number, from the first message to the next sale.
        </h2>

        <ol className="mt-10 grid gap-x-6 gap-y-8 sm:grid-cols-3 lg:grid-cols-6">
          {STEPS.map(({ title, body }, i) => (
            <li key={title} className="border-t-2 border-forest pt-4">
              <p className="text-[0.82rem] font-medium text-ink/65">Step {i + 1}</p>
              <h3 className="mt-1.5 text-[1.15rem]">{title}</h3>
              <p className="mt-2 text-[0.92rem] text-ink/70">{body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
