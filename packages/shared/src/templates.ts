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
        'Namaste {{1}} ji, aapki {{2}} ki free demo class {{3}} ko {{4}} baje book ho gayi hai. Pata: {{5}}',
      hi: 'नमस्ते {{1}} जी, आपकी {{2}} की फ्री डेमो क्लास {{3}} को {{4}} बजे बुक हो गई है। पता: {{5}}',
      en: 'Hello {{1}}, your free {{2}} demo class is booked for {{3}} at {{4}}. Address: {{5}}',
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
      hinglish: '{{1}} ji, demo kaisi lagi? Admission ya koi sawaal ho to reply karein.',
      hi: '{{1}} जी, डेमो कैसी लगी? एडमिशन या कोई सवाल हो तो जवाब दें।',
      en: "{{1}}, how was the demo? Reply if you'd like to join or have a question.",
    },
  },
  {
    purpose: 'fee_upcoming',
    category: 'utility',
    variables: ['student_name', 'course', 'amount', 'due_date', 'link'],
    body: {
      hinglish: '{{1}} ki {{2}} fees ₹{{3}} ki kisht {{4}} ko due hai. Pay karne ke liye: {{5}}',
      hi: '{{1}} की {{2}} फीस की ₹{{3}} की किश्त {{4}} को देय है। भुगतान के लिए: {{5}}',
      en: "{{1}}'s {{2}} fee installment of ₹{{3}} is due on {{4}}. Pay here: {{5}}",
    },
  },
  {
    purpose: 'fee_due',
    category: 'utility',
    variables: ['student_name', 'amount', 'link'],
    body: {
      hinglish: 'Aaj {{1}} ki fees ₹{{2}} due hai. Link: {{3}}',
      hi: 'आज {{1}} की फीस ₹{{2}} देय है। लिंक: {{3}}',
      en: "{{1}}'s fee of ₹{{2}} is due today. Link: {{3}}",
    },
  },
  {
    purpose: 'fee_overdue',
    category: 'utility',
    variables: ['student_name', 'amount', 'link'],
    body: {
      hinglish: '{{1}} ki fees ₹{{2}} baaki hai. Kripya jald bhugtan karein: {{3}}',
      hi: '{{1}} की फीस ₹{{2}} बाकी है। कृपया जल्द भुगतान करें: {{3}}',
      en: "{{1}}'s fee of ₹{{2}} is pending. Please pay soon: {{3}}",
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
