import { useEffect, useState } from 'react'
import { Menu, X } from 'lucide-react'
import { PrimaryCTA, Wordmark } from './Brand'
import { useScrolled } from '../lib/hooks'

const links = [
  { label: 'What it does', href: '#what-it-does' },
  { label: 'The cost', href: '#calculator' },
  { label: 'How it works', href: '#how-it-works' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'Questions', href: '#faq' },
]

export default function Nav() {
  const scrolled = useScrolled(12)
  const [open, setOpen] = useState(false)

  // Close the mobile menu on route-hash navigation, resize to desktop, or Escape.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    const onResize = () => window.innerWidth >= 1024 && setOpen(false)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
      document.body.style.overflow = ''
    }
  }, [open])

  return (
    <header
      className={`sticky top-0 z-40 transition-[background-color,border-color,box-shadow] duration-300 ${
        scrolled || open
          ? 'border-b border-line bg-white shadow-[0_1px_0_rgb(14_16_19_/_0.02),0_12px_28px_-20px_rgb(14_16_19_/_0.18)]'
          : 'border-b border-transparent bg-transparent'
      }`}
    >
      <nav className="mx-auto flex max-w-[1180px] items-center justify-between px-5 py-4 sm:px-8">
        <a href="#top" className="flex items-center" aria-label="haazir — home" onClick={() => setOpen(false)}>
          <Wordmark size={32} />
        </a>

        <ul className="hidden items-center gap-8 lg:flex">
          {links.map((link) => (
            <li key={link.href}>
              <a href={link.href} className="nav-link text-[0.94rem] text-ink/65 transition-colors hover:text-ink">
                {link.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-2">
          {/* A wrapper controls visibility so it never has to fight the
              button's own unconditional `inline-flex` for the `display`
              cascade — see PrimaryCTA's `base` classes in Brand.jsx. */}
          <div className="hidden sm:block">
            <PrimaryCTA context="nav" className="px-5 py-2.5 text-[0.9rem]">Talk to us</PrimaryCTA>
          </div>

          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-line text-ink transition-colors hover:border-ink/25 lg:hidden"
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="h-5 w-5" strokeWidth={1.75} /> : <Menu className="h-5 w-5" strokeWidth={1.75} />}
          </button>
        </div>
      </nav>

      {open && (
        <div
          id="mobile-menu"
          className="animate-fade-down border-t border-line bg-white px-5 pt-2 pb-6 lg:hidden"
        >
          <ul className="flex flex-col divide-y divide-line">
            {links.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="block py-3.5 text-[1.05rem] text-ink/80 transition-colors hover:text-clay-deep"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
          <PrimaryCTA context="nav" className="mt-5 w-full">Talk to us</PrimaryCTA>
        </div>
      )}
    </header>
  )
}
