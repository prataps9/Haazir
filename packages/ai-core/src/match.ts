import type { courses } from '@haazir/db'

type Course = typeof courses.$inferSelect

const normalise = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu, '')

function distance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) dp[0]![j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
  return dp[a.length]![b.length]!
}

/**
 * "rscit", "RS CIT", "rs-cit course", "tally", "pyton" all find their course.
 * Returns null rather than guess when nothing is close.
 */
export function matchCourse(list: Course[], query: string): Course | null {
  const q = normalise(query.replace(/\bcourse\b|\bkorse\b|\bclass\b/gi, ''))
  if (!q) return null
  let best: { course: Course; score: number } | null = null
  for (const course of list) {
    const names = [course.shortName, course.name].map(normalise)
    const firstWord = normalise(course.shortName.split(/[\s+]/)[0] ?? '')
    let score = 0
    if (names.includes(q)) score = 4
    else if (names.some((n) => n.startsWith(q) || q.startsWith(n))) score = 3
    else if (firstWord.length >= 4 && (q.includes(firstWord) || firstWord.includes(q))) score = 2
    else if (names.some((n) => distance(n.slice(0, q.length + 1), q) <= (q.length > 5 ? 2 : 1)))
      score = 1
    if (score && (!best || score > best.score)) best = { course, score }
  }
  return best?.course ?? null
}
