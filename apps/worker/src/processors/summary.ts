import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { ledgerNumbers } from '@haazir/coaching'
import { contacts, memberships, organizations, users } from '@haazir/db'
import {
  announceMessage,
  sendAutomation,
  TEAM_OPT_IN_SOURCE,
  type SummaryJob,
} from '@haazir/messaging'
import { formatPaise } from '@haazir/shared'
import type { Deps } from '../deps'

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000
const istDate = (d: Date) => new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10)

/**
 * The owner's 8 PM summary on WhatsApp (spec §13 `daily_summary`): "Aaj ka
 * hisaab: enquiries, demos, admissions, fees". The scheduled job fans out one
 * job per org (job id per org and day, so it runs once); each sends to the
 * owners and admins who turned it on and gave their number.
 */
export async function processSummary(deps: Deps, job: SummaryJob) {
  const day = job.day ?? istDate(deps.now())
  if (!job.orgId) {
    const orgs = await deps.db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.status, 'active'))
    for (const org of orgs)
      await deps.queues.summary.add(
        'summary',
        { orgId: org.id, day },
        { jobId: `summary-${org.id}-${day}` },
      )
    return { orgs: orgs.length }
  }
  return sendOrgSummary(deps, job.orgId, day)
}

export async function sendOrgSummary(deps: Deps, orgId: string, day: string) {
  const people = await deps.db
    .select({
      userId: users.id,
      phone: users.phone,
      name: users.name,
      prefs: memberships.notifyPrefs,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.orgId, orgId),
        inArray(memberships.role, ['owner', 'admin']),
        isNotNull(users.phone),
      ),
    )
  const wanted = people.filter((p) => p.prefs?.dailySummary && p.phone)
  if (!wanted.length) return { sent: 0 }

  const n = await ledgerNumbers(deps.db, orgId, day)
  const values = [
    String(n.enquiries),
    String(n.demosBooked),
    String(n.admissions),
    formatPaise(n.feesCollectedPaise).replace('₹', ''),
  ]
  let sent = 0
  for (const person of wanted) {
    const key = `haazir:summary:${orgId}:${person.userId}:${day}`
    if (await deps.kv.exists(key)) continue
    const contactId = await teamContact(deps, orgId, person.phone!, person.name)
    if (!contactId) continue
    const result = await sendAutomation(
      { db: deps.db, outboundQueue: deps.queues.outbound },
      {
        orgId,
        contactId,
        purpose: 'daily_summary',
        values,
        urgent: true, // they asked for it at 8 PM; a retry a little later still helps
        sentBy: 'system',
        now: deps.now(),
      },
    )
    if (result.sent) {
      await deps.kv.set(key, '1', 2 * 24 * 60 * 60)
      await announceMessage(deps.db, deps.events, orgId, result.message.id, 'message:new')
      sent++
    } else {
      deps.log.info({ orgId, reason: result.reason }, 'daily summary not sent')
    }
  }
  return { sent }
}

/**
 * The team member's own number as a contact of the org, marked as team so
 * campaigns never include it. They opted in by turning the summary on, unless
 * they once sent STOP to this number, which stands.
 */
async function teamContact(deps: Deps, orgId: string, phone: string, name: string) {
  await deps.db
    .insert(contacts)
    .values({
      orgId,
      waId: phone,
      name,
      optInStatus: 'opted_in',
      optInSource: TEAM_OPT_IN_SOURCE,
      optInAt: deps.now(),
    })
    .onConflictDoNothing()
  const [contact] = await deps.db
    .select()
    .from(contacts)
    .where(and(eq(contacts.orgId, orgId), eq(contacts.waId, phone)))
  if (!contact || contact.optInStatus === 'opted_out') return null
  if (contact.optInSource !== TEAM_OPT_IN_SOURCE)
    await deps.db
      .update(contacts)
      .set({ optInStatus: 'opted_in', optInSource: TEAM_OPT_IN_SOURCE, optInAt: deps.now() })
      .where(eq(contacts.id, contact.id))
  return contact.id
}
