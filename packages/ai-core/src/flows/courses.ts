import type { courses } from '@haazir/db'
import { formatPaise } from '@haazir/shared'
import type { ReplyLanguage } from '../language'
import type { ReplyContent } from '../pipeline'
import { BUTTON, fill, FLOW } from './copy'

type Course = typeof courses.$inferSelect

const LABEL = {
  fee: { hinglish: 'Fees', hi: 'फीस', en: 'Fee' },
  duration: { hinglish: 'Avadhi', hi: 'अवधि', en: 'Duration' },
  installments: { hinglish: 'Kishtein', hi: 'किश्तें', en: 'Installments' },
  certificate: { hinglish: 'Certificate', hi: 'सर्टिफ़िकेट', en: 'Certificate' },
  mode: {
    hinglish: { offline: 'Institute mein', online: 'Online', hybrid: 'Institute + online' },
    hi: { offline: 'इंस्टीट्यूट में', online: 'ऑनलाइन', hybrid: 'इंस्टीट्यूट + ऑनलाइन' },
    en: { offline: 'At the institute', online: 'Online', hybrid: 'Institute + online' },
  },
  atAdmission: { hinglish: 'admission par', hi: 'एडमिशन पर', en: 'at admission' },
  afterDays: { hinglish: '{n} din baad', hi: '{n} दिन बाद', en: 'after {n} days' },
} as const

/** "Courses dekhein": every active course, its fee and duration, as a WhatsApp list. */
export function courseList(list: Course[], lang: ReplyLanguage): ReplyContent | null {
  const active = list.filter((c) => c.active).slice(0, 10)
  if (!active.length) return null
  return {
    kind: 'list',
    body: FLOW.pickCourseToSee[lang],
    buttonLabel: BUTTON.pickCourse[lang],
    sections: [
      {
        rows: active.map((c) => ({
          id: `course:${c.id}`,
          title: c.shortName.slice(0, 24),
          description: [formatPaise(c.feeTotalPaise), c.durationText]
            .filter(Boolean)
            .join(' · ')
            .slice(0, 72),
        })),
      },
    ],
  }
}

/**
 * One course, straight from the database: every number in it is the number
 * in the courses table, so no guardrail is needed and no AI either.
 */
export function courseCard(course: Course, lang: ReplyLanguage): ReplyContent {
  const lines = [`*${course.name}*`]
  if (course.description) lines.push(course.description)
  lines.push('')
  lines.push(`${LABEL.fee[lang]}: *${formatPaise(course.feeTotalPaise)}*`)
  if (course.durationText) lines.push(`${LABEL.duration[lang]}: ${course.durationText}`)
  lines.push(LABEL.mode[lang][course.mode])
  if (course.installmentPlan.length > 1) {
    lines.push(`${LABEL.installments[lang]}:`)
    for (const step of course.installmentPlan) {
      const when =
        step.dueOffsetDays === 0
          ? LABEL.atAdmission[lang]
          : fill(LABEL.afterDays[lang], { n: String(step.dueOffsetDays) })
      lines.push(`• ${step.label}: ${formatPaise(step.amountPaise)} (${when})`)
    }
  }
  if (course.certificateText) lines.push(`${LABEL.certificate[lang]}: ${course.certificateText}`)

  const buttons = [
    {
      id: `demo_course:${course.id}`,
      title: { hinglish: 'Free demo', hi: 'फ्री डेमो', en: 'Free demo' }[lang],
    },
  ]
  if (course.brochureKey)
    buttons.push({ id: `brochure:${course.id}`, title: BUTTON.brochure[lang] })
  buttons.push({
    id: 'menu_talk',
    title: { hinglish: 'Baat karein', hi: 'बात करें', en: 'Talk to us' }[lang],
  })
  return { kind: 'buttons', body: lines.join('\n').slice(0, 1024), buttons }
}
