import { whatsappLink } from '../lib/site'

/**
 * The jharokha mark: a pointed, cusped Rajasthani arch with a notch at its
 * base. Drawn inline so it inherits colour and stays crisp at any size.
 */
export function JharokhaArch({ className = '', ...props }) {
  return (
    <svg viewBox="0 0 100 100" fill="none" className={className} aria-hidden="true" {...props}>
      <path
        d="M26 86V58q6.7-4.4 4-12 7.5-3.8 6-12 7.8-3.5 7-12 7-1.8 7-9 0 7.2 7 9-.8 8.5 7 12-1.5 8.2 6 12-2.7 7.6 4 12v28H58v-8H42v8H26Z"
        fill="currentColor"
      />
    </svg>
  )
}

/** Terracotta tile + white arch. */
export function LogoMark({ size = 34, className = '' }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-[28%] bg-clay ${className}`}
      style={{ width: size, height: size }}
    >
      <JharokhaArch className="text-paper" style={{ width: size * 0.62, height: size * 0.62 }} />
    </span>
  )
}

export function Wordmark({ size = 34, tone = 'dark', className = '' }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark size={size} />
      <span
        className={`text-[1.35rem] font-semibold tracking-[-0.045em] lowercase ${
          tone === 'light' ? 'text-paper' : 'text-ink'
        }`}
      >
        haazir
      </span>
    </span>
  )
}

/** Meta's WhatsApp glyph, drawn rather than imported as a brand image. */
export function WhatsAppGlyph({ className = 'h-[1.05em] w-[1.05em]' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91C21.96 6.45 17.5 2 12.04 2Zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.22 8.22 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.25-8.23 2.2 0 4.27.86 5.83 2.42a8.19 8.19 0 0 1 2.41 5.82c0 4.54-3.7 8.23-8.24 8.23Zm4.52-6.16c-.25-.13-1.47-.72-1.69-.8-.23-.09-.39-.13-.56.12-.16.25-.64.8-.79.97-.14.16-.29.19-.54.06-.25-.12-1.05-.38-2-1.23-.74-.66-1.24-1.47-1.38-1.72-.15-.25-.02-.39.11-.51.11-.11.25-.29.37-.44.13-.14.17-.25.25-.41.09-.17.04-.31-.02-.44-.06-.12-.56-1.35-.77-1.84-.2-.48-.41-.42-.56-.43h-.48c-.16 0-.43.06-.65.31-.23.25-.86.84-.86 2.05s.88 2.38 1 2.54c.12.17 1.73 2.64 4.19 3.7.59.26 1.04.41 1.4.52.59.19 1.12.16 1.54.1.47-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.23-.16-.48-.29Z" />
    </svg>
  )
}

const base =
  'inline-flex items-center justify-center gap-2.5 rounded-full px-6 py-3.5 text-[0.96rem] font-medium tracking-[-0.01em] transition-[transform,background-color,border-color,box-shadow] duration-200 active:scale-[0.97]'

/**
 * `context` decides which opening line lands in the customer's chat — see
 * OPENERS in lib/site.js. `extra` folds a detail into it (the calculator's figure).
 * `tone="light"` is the same button for a dark panel.
 */
export function PrimaryCTA({
  children = 'Start on WhatsApp',
  className = '',
  context = 'hero',
  extra = '',
  href,
  tone = 'dark',
}) {
  const look =
    tone === 'light'
      ? 'bg-paper text-ink hover:bg-white'
      : 'bg-clay-deep text-white shadow-[0_8px_18px_-10px_rgb(168_72_43_/_0.65)] hover:bg-[#8f3c23]'

  return (
    <a
      href={href ?? whatsappLink(context, extra)}
      target="_blank"
      rel="noopener noreferrer"
      className={`${base} ${look} ${className}`}
    >
      <WhatsAppGlyph />
      {children}
    </a>
  )
}

export function GhostCTA({ children, href = '#pricing', className = '' }) {
  return (
    <a
      href={href}
      className={`${base} border border-ink/15 bg-white text-ink hover:border-ink/30 ${className}`}
    >
      {children}
    </a>
  )
}

/** A small pill above a section heading. Sentence case, no rule, no shouting. */
export function SectionLabel({ children, tone = 'dark' }) {
  return (
    <p
      className={`mb-5 inline-flex items-center gap-2 rounded-full border py-1 pr-3.5 pl-2.5 text-[0.82rem] font-medium ${
        tone === 'light'
          ? 'border-paper/20 text-paper/80'
          : 'border-line bg-white text-ink/70'
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${tone === 'light' ? 'bg-clay-soft' : 'bg-clay'}`}
        aria-hidden="true"
      />
      {children}
    </p>
  )
}
