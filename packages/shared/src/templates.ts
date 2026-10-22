import type { TemplatePurpose } from './constants'

/** Which language variant of a message a contact gets. */
export type CopyLanguage = 'hi' | 'hinglish' | 'en'

export interface DefaultTemplate {
  purpose: TemplatePurpose
  category: 'utility' | 'marketing'
  /** What each {{n}} means, in order. */
  variables: string[]
  body: Record<CopyLanguage, string>
  /** Quick-reply buttons, if any (ids are ours; titles are what the person taps). */
  buttons?: { id: string; title: Record<CopyLanguage, string> }[]
}

/**
 * The automations' messages (spec §13). Seeded as drafts for every org; Phase 5
 * submits them to Meta. Inside the 24-hour window the same text goes free-form,
 * so a person reads the same words either way.
 *
 * Meta names: `{purpose}` in `hi` (Devanagari) and `en` (English), and
 * `{purpose}_hinglish` under `en`, since Meta has no Hinglish language code.
 */
export const DEFAULT_TEMPLATES: DefaultTemplate[] = [
  {
    purpose: 'demo_confirm',
    category: 'utility',
    variables: ['student_name', 'course', 'date', 'time', 'address'],
    body: {
      hinglish:
        'Namaste {{1}} ji, aapki {{2}} ki free demo class {{3}} ko {{4}} baje book ho gayi hai. Pata: {{5}}. Milte hain!',
      hi: 'नमस्ते {{1}} जी, आपकी {{2}} की फ्री डेमो क्लास {{3}} को {{4}} बजे बुक हो गई है। पता: {{5}}। मिलते हैं!',
      en: 'Hello {{1}}, your free {{2}} demo class is booked for {{3}} at {{4}}. Address: {{5}}. See you there!',
    },
  },
  {
    purpose: 'demo_reminder',
    category: 'utility',
    variables: ['time', 'course'],
    body: {
      hinglish: 'Yaad dilana tha: aaj {{1}} baje aapki {{2}} demo class hai. Aa rahe hain?',
      hi: 'याद दिलाना था: आज {{1}} बजे आपकी {{2}} डेमो क्लास है। आ रहे हैं?',
      en: 'A reminder: your {{2}} demo class is today at {{1}}. Will you come?',
    },
    buttons: [
      {
        id: 'demo_yes',
        title: { hinglish: 'Haan, aa raha hoon', hi: 'हाँ, आ रहे हैं', en: 'Yes, coming' },
      },
      {
        id: 'demo_reschedule',
        title: { hinglish: 'Time badlo', hi: 'समय बदलें', en: 'Change time' },
      },
    ],
  },
  {
    purpose: 'followup',
    category: 'marketing',
    variables: ['name'],
    body: {
      hinglish: 'Namaste {{1}} ji, demo kaisi lagi? Admission ya koi sawaal ho to reply karein.',
      hi: 'नमस्ते {{1}} जी, डेमो कैसी लगी? एडमिशन या कोई सवाल हो तो जवाब दें।',
      en: "Hello {{1}}, how was the demo? Reply if you'd like to join or have a question.",
    },
  },
  {
    purpose: 'fee_upcoming',
    category: 'utility',
    variables: ['student_name', 'course', 'amount', 'due_date', 'link'],
    body: {
      hinglish:
        'Namaste! {{1}} ki {{2}} fees ₹{{3}} ki kisht {{4}} ko due hai. Pay karne ke liye: {{5}} . Dhanyavaad.',
      hi: 'नमस्ते! {{1}} की {{2}} फीस की ₹{{3}} की किश्त {{4}} को देय है। भुगतान के लिए: {{5}} । धन्यवाद।',
      en: "Hello! {{1}}'s {{2}} fee installment of ₹{{3}} is due on {{4}}. Pay here: {{5}} . Thank you.",
    },
  },
  {
    purpose: 'fee_due',
    category: 'utility',
    variables: ['student_name', 'amount', 'link'],
    body: {
      hinglish: 'Aaj {{1}} ki fees ₹{{2}} due hai. Link: {{3}} . Dhanyavaad.',
      hi: 'आज {{1}} की फीस ₹{{2}} देय है। लिंक: {{3}} । धन्यवाद।',
      en: "Today {{1}}'s fee of ₹{{2}} is due. Link: {{3}} . Thank you.",
    },
  },
  {
    purpose: 'fee_overdue',
    category: 'utility',
    variables: ['student_name', 'amount', 'link'],
    body: {
      hinglish:
        'Namaste, {{1}} ki fees ₹{{2}} baaki hai. Kripya jald bhugtan karein: {{3}} . Dhanyavaad.',
      hi: 'नमस्ते, {{1}} की फीस ₹{{2}} बाकी है। कृपया जल्द भुगतान करें: {{3}} । धन्यवाद।',
      en: "Hello, {{1}}'s fee of ₹{{2}} is pending. Please pay soon: {{3}} . Thank you.",
    },
  },
  {
    purpose: 'payment_received',
    category: 'utility',
    variables: ['amount', 'receipt_no'],
    body: {
      hinglish: '₹{{1}} mil gaye, dhanyavaad! Receipt no. {{2}}.',
      hi: '₹{{1}} मिल गए, धन्यवाद! रसीद नंबर {{2}}।',
      en: 'We received ₹{{1}}, thank you! Receipt no. {{2}}.',
    },
  },
  {
    purpose: 'daily_summary',
    category: 'utility',
    variables: ['enquiries', 'demos', 'admissions', 'fees'],
    body: {
      hinglish:
        'Aaj ka hisaab: enquiries {{1}}, demo booked {{2}}, admissions {{3}}, fees mili ₹{{4}}.',
      hi: 'आज का हिसाब: पूछताछ {{1}}, डेमो बुक {{2}}, एडमिशन {{3}}, फीस मिली ₹{{4}}।',
      en: "Today's numbers: enquiries {{1}}, demos booked {{2}}, admissions {{3}}, fees received ₹{{4}}.",
    },
  },
  {
    purpose: 'announcement',
    category: 'marketing',
    variables: ['batch', 'date'],
    body: {
      hinglish: 'Naya batch {{1}} {{2}} se shuru. Seats limited. Details ke liye reply karein.',
      hi: 'नया बैच {{1}} {{2}} से शुरू। सीटें सीमित। जानकारी के लिए जवाब दें।',
      en: 'New batch {{1}} starts {{2}}. Limited seats. Reply for details.',
    },
  },
]

/** Meta's name and language code for one of our template variants. */
export function templateKey(purpose: TemplatePurpose, lang: CopyLanguage) {
  return lang === 'hinglish'
    ? { name: `${purpose}_hinglish`, language: 'en' }
    : { name: purpose, language: lang }
}

/** "Namaste {{1}} ji" + ["Anil"] → "Namaste Anil ji". Missing values stay visible as {{n}}. */
export function fillTemplate(text: string, values: string[]): string {
  return text.replace(/\{\{(\d+)\}\}/g, (m, n: string) => values[Number(n) - 1] ?? m)
}

export function defaultTemplate(purpose: TemplatePurpose): DefaultTemplate | undefined {
  return DEFAULT_TEMPLATES.find((t) => t.purpose === purpose)
}

/** Meta's own examples for each variable we use, sent with a submission (Meta requires them). */
const SAMPLES: Record<string, string> = {
  student_name: 'Anil',
  name: 'Anil',
  contact_name: 'Anil',
  course: 'RS-CIT',
  batch: 'RS-CIT Subah',
  date: '25 Oct',
  due_date: '25 Oct',
  time: '5:00 pm',
  address: 'Station Road, Sikar',
  amount: '4,500',
  link: 'https://rzp.io/i/abc123',
  receipt_no: 'R-0001',
  enquiries: '7',
  demos: '3',
  admissions: '2',
  fees: '9,000',
}
export function sampleValue(variable: string | undefined, n: number): string {
  return (variable && SAMPLES[variable]) || `sample ${n}`
}

/** The parts of a template people edit; `components` (Meta's shape) is built from these. */
export interface TemplateParts {
  header?: string
  body: string
  footer?: string
  buttons?: TemplateButton[]
}
export type TemplateButton =
  | { type: 'QUICK_REPLY'; text: string }
  | { type: 'URL'; text: string; url: string }
  | { type: 'PHONE_NUMBER'; text: string; phone_number: string }

type Component = Record<string, unknown>

export function partsOf(components: Component[]): TemplateParts {
  const find = (type: string) => components.find((c) => c.type === type)
  const header = find('HEADER')
  const footer = find('FOOTER')
  const buttons = find('BUTTONS') as { buttons?: TemplateButton[] } | undefined
  return {
    header: typeof header?.text === 'string' ? header.text : undefined,
    body: (find('BODY')?.text as string | undefined) ?? '',
    footer: typeof footer?.text === 'string' ? footer.text : undefined,
    buttons: buttons?.buttons?.length ? buttons.buttons : undefined,
  }
}

/** Our stored components (no examples). */
export function componentsOf(parts: TemplateParts): Component[] {
  const out: Component[] = []
  if (parts.header) out.push({ type: 'HEADER', format: 'TEXT', text: parts.header })
  out.push({ type: 'BODY', text: parts.body })
  if (parts.footer) out.push({ type: 'FOOTER', text: parts.footer })
  if (parts.buttons?.length) out.push({ type: 'BUTTONS', buttons: parts.buttons })
  return out
}

/** Components as Meta's create endpoint wants them: with an example for every {{n}}. */
export function componentsForMeta(components: Component[], variables: string[]): Component[] {
  return components.map((c) => {
    if (c.type !== 'BODY') return c
    const n = variableCount(String(c.text ?? ''))
    if (!n) return c
    return {
      ...c,
      example: {
        body_text: [Array.from({ length: n }, (_, i) => sampleValue(variables[i], i + 1))],
      },
    }
  })
}

/** The highest {{n}} in a text (0 if none). */
export function variableCount(text: string): number {
  let max = 0
  for (const m of text.matchAll(/\{\{(\d+)\}\}/g)) max = Math.max(max, Number(m[1]))
  return max
}

/**
 * Meta's rules for a template, checked before submitting so the owner hears
 * about a problem now rather than in a rejection a day later. Returns the
 * problems as stable keys (the dashboard translates them).
 */
export function templateProblems(parts: TemplateParts): string[] {
  const problems: string[] = []
  const body = parts.body.trim()
  if (!body) problems.push('body_empty')
  if (body.length > 1024) problems.push('body_too_long')
  const used = [...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]))
  const n = variableCount(body)
  for (let i = 1; i <= n; i++) if (!used.includes(i)) problems.push('variables_not_sequential')
  if (/^\{\{\d+\}\}/.test(body) || /\{\{\d+\}\}$/.test(body)) problems.push('variable_at_edge')
  if (/\{\{\d+\}\}\s*\{\{\d+\}\}/.test(body)) problems.push('variables_adjacent')
  if (parts.header && (parts.header.length > 60 || /\{\{/.test(parts.header)))
    problems.push('header_invalid')
  if (parts.footer && (parts.footer.length > 60 || /\{\{/.test(parts.footer)))
    problems.push('footer_invalid')
  if ((parts.buttons?.length ?? 0) > 3) problems.push('too_many_buttons')
  if (parts.buttons?.some((b) => !b.text.trim() || b.text.length > 25))
    problems.push('button_text_invalid')
  return [...new Set(problems)]
}

/**
 * Meta's template names: lower case letters, digits and underscores.
 * Hindi names have no letters to keep, so they fall back to `template`.
 */
export function templateSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
  return slug || 'template'
}

/**
 * A value for a template parameter. Meta rejects parameters with new lines,
 * tabs or more than four spaces in a row (error 132018), so flatten them.
 */
export function templateParam(value: string): string {
  return value.replace(/\s+/g, ' ').trim() || '-'
}
