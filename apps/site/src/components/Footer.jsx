import { Wordmark } from './Brand'
import { SEGMENTS } from '../lib/segments'
import { EMAIL, LOCATION } from '../lib/site'

const PAGE = [
  { label: 'What it does', href: '#what-it-does' },
  { label: 'The cost of silence', href: '#calculator' },
  { label: 'How it works', href: '#how-it-works' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'Questions', href: '#faq' },
]

const link =
  'text-[0.95rem] text-paper/75 underline-offset-4 transition-colors hover:text-white hover:underline'

export default function Footer() {
  return (
    <footer className="bg-ink text-paper">
      <div className="mx-auto max-w-[1180px] px-5 pt-14 pb-10 sm:px-8">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <Wordmark size={34} tone="light" />
            <p className="mt-5 max-w-[26ch] text-[0.95rem] text-paper/75">
              WhatsApp AI agents for premium Indian businesses. Someone is always at the window.
            </p>
          </div>

          <nav aria-label="On this page">
            <p className="text-[0.9rem] font-medium text-paper">The page</p>
            <ul className="mt-4 space-y-2.5">
              {PAGE.map((item) => (
                <li key={item.href}>
                  <a href={item.href} className={link}>
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label="Built for">
            <p className="text-[0.9rem] font-medium text-paper">Built for</p>
            <ul className="mt-4 space-y-2.5">
              {SEGMENTS.map((segment) => (
                <li key={segment.slug}>
                  <a href={`/${segment.slug}`} className={link}>
                    {segment.name.charAt(0).toUpperCase() + segment.name.slice(1)}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div>
            <p className="text-[0.9rem] font-medium text-paper">Get in touch</p>
            <ul className="mt-4 space-y-2.5">
              <li>
                <a href={`mailto:${EMAIL}`} className={link}>
                  {EMAIL}
                </a>
              </li>
              <li className="text-[0.95rem] text-paper/75">{LOCATION}</li>
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-2 border-t border-paper/15 pt-6 text-[0.85rem] text-paper/70 sm:flex-row sm:justify-between">
          <p>&copy; {new Date().getFullYear()} haazir. Built in Jaipur.</p>
          <p>Runs on the official WhatsApp Business Platform.</p>
        </div>
      </div>
    </footer>
  )
}
