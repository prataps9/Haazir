import { and, eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  campaignRecipients,
  campaigns,
  contacts,
  conversations,
  leads,
  memberships,
  messages,
  templates,
  users,
} from '@haazir/db'
import {
  audienceCount,
  campaignResults,
  estimateCost,
  TEAM_OPT_IN_SOURCE,
  type CampaignJob,
} from '@haazir/messaging'
import { CAMPAIGN_BATCH_SIZE, CAMPAIGN_SEND_INTERVAL_MS, costPaise } from '@haazir/shared'
import { processAiReply } from '../processors/aiReply'
import { processCampaign } from '../processors/campaign'
import { processInbound } from '../processors/inbound'
import { processOutbound } from '../processors/outbound'
import { processSummary } from '../processors/summary'
import { processTemplateSync } from '../processors/templateSync'
import {
  createHarness,
  inboundText,
  mockGraph,
  statusUpdate,
  WABA_ID,
  type Recorded,
} from './harness'

const graph = mockGraph()
let h: Awaited<ReturnType<typeof createHarness>>

beforeAll(() => graph.server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => graph.server.close())
beforeEach(async () => {
  h = await createHarness()
})
afterEach(async () => {
  graph.reset()
  await h.close()
})

const phone = (i: number) => `9198700${String(i).padStart(5, '0')}`

/**
 * 50 opted-in contacts (tagged "parent"), 3 who sent STOP and 2 who never
 * said yes, all tagged alike: only the 50 may get a campaign.
 */
async function audience() {
  const rows = [
    ...Array.from({ length: 50 }, (_, i) => ({ i, optInStatus: 'opted_in' as const })),
    ...[50, 51, 52].map((i) => ({ i, optInStatus: 'opted_out' as const })),
    ...[53, 54].map((i) => ({ i, optInStatus: 'unknown' as const })),
  ]
  await h.db.insert(contacts).values(
    rows.map(({ i, optInStatus }) => ({
      orgId: h.org.id,
      waId: phone(i),
      name: `Parent ${i}`,
      tags: ['parent'],
      optInStatus,
      createdAt: new Date(Date.UTC(2026, 8, 1, 0, 0, i)),
    })),
  )
}

async function approvedTemplate() {
  const [t] = await h.db
    .update(templates)
    .set({ status: 'approved', metaTemplateId: 'meta-announcement' })
    .where(and(eq(templates.orgId, h.org.id), eq(templates.name, 'announcement_hinglish')))
    .returning()
  return t!
}

async function scheduledCampaign() {
  const t = await approvedTemplate()
  const count = await audienceCount(h.db, h.org.id, { tags: ['parent'] })
  const estimate = await estimateCost(h.db, {
    recipients: count.count,
    category: t.category,
    on: h.deps.now(),
  })
  const [c] = await h.db
    .insert(campaigns)
    .values({
      orgId: h.org.id,
      name: 'Naya batch',
      templateId: t.id,
      audience: { tags: ['parent'] },
      variableMap: [
        { source: 'custom', text: 'RS-CIT Shaam' },
        { source: 'custom', text: '1 Nov' },
      ],
      status: 'scheduled',
      scheduledAt: h.deps.now(),
      estimatedRecipients: count.count,
      estimatedCostPaise: estimate.costPaise,
    })
    .returning()
  return { campaign: c!, template: t, estimate }
}

/** Runs campaign jobs the way BullMQ would, each one in turn, until none are left. */
async function drainCampaign() {
  const runs: { job: Recorded<CampaignJob>; outboundBefore: number }[] = []
  for (let guard = 0; guard < 20; guard++) {
    const job = h.queues.campaign.jobs.shift()
    if (!job) break
    runs.push({ job, outboundBefore: h.queues.outbound.jobs.length })
    await processCampaign(h.deps, job.data)
  }
  return runs
}

describe('a campaign to 50 opted-in contacts (Phase 5 "done when")', () => {
  it('sends to exactly the 50, throttled, and actual cost matches the estimate', async () => {
    await audience()
    const { campaign, template, estimate } = await scheduledCampaign()
    // The estimate: 50 marketing messages at ₹0.8631.
    expect(estimate.recipients).toBe(50)
    expect(estimate.costPaise).toBe(costPaise(50, 8631))
    expect(estimate.costPaise).toBe(4316)

    await h.queues.campaign.add('start', { orgId: h.org.id, campaignId: campaign.id })
    const runs = await drainCampaign()

    // Two batches of 25, then done.
    expect(runs).toHaveLength(2)
    expect(runs[1]!.job.opts?.delay).toBe(CAMPAIGN_BATCH_SIZE * CAMPAIGN_SEND_INTERVAL_MS)
    const out = h.queues.outbound.jobs
    expect(out).toHaveLength(50)
    // Throttled: within a batch, each message waits its turn.
    expect(out.slice(0, 25).map((j) => j.opts?.delay)).toEqual(
      Array.from({ length: 25 }, (_, i) => i * CAMPAIGN_SEND_INTERVAL_MS),
    )

    const [done] = await h.db.select().from(campaigns).where(eq(campaigns.id, campaign.id))
    expect(done?.status).toBe('done')

    // Nobody who said STOP or never said yes is in it.
    const recipients = await h.db
      .select({ waId: contacts.waId, status: campaignRecipients.status })
      .from(campaignRecipients)
      .innerJoin(contacts, eq(contacts.id, campaignRecipients.contactId))
      .where(eq(campaignRecipients.campaignId, campaign.id))
    expect(recipients).toHaveLength(50)
    expect(recipients.map((r) => r.waId).sort()).toEqual(
      Array.from({ length: 50 }, (_, i) => phone(i)),
    )

    // The outbound worker sends them; Meta reports them delivered and charged as marketing.
    for (const job of out.splice(0)) await processOutbound(h.deps, job.data)
    expect(graph.sent).toHaveLength(50)
    expect(graph.sent[0]!.body).toMatchObject({
      type: 'template',
      template: {
        name: 'announcement_hinglish',
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: 'RS-CIT Shaam' },
              { type: 'text', text: '1 Nov' },
            ],
          },
        ],
      },
    })
    const sent = await h.db
      .select({ waMessageId: messages.waMessageId, to: contacts.waId })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .innerJoin(contacts, eq(contacts.id, conversations.contactId))
      .where(eq(messages.sentBy, 'campaign'))
    for (const m of sent)
      await processInbound(h.deps, {
        payload: statusUpdate(m.waMessageId!, 'delivered', undefined, {
          recipient: m.to,
          pricing: { billable: true, category: 'marketing' },
        }),
      })

    const results = await campaignResults(h.db, done!, template)
    expect(results).toMatchObject({ recipients: 50, sent: 50, delivered: 50, failed: 0 })
    expect(results.actualCostPaise).toBe(estimate.costPaise)
  })

  it('doesn’t push 50 broadcasts to the top of the inbox; a reply does', async () => {
    await audience()
    const { campaign } = await scheduledCampaign()
    await processCampaign(h.deps, { orgId: h.org.id, campaignId: campaign.id })
    const bumped = await h.db
      .select({ lastMessageAt: conversations.lastMessageAt })
      .from(conversations)
      .innerJoin(campaignRecipients, eq(campaignRecipients.contactId, conversations.contactId))
      .where(eq(campaignRecipients.campaignId, campaign.id))
    expect(bumped.length).toBeGreaterThan(0)
    expect(bumped.every((c) => c.lastMessageAt === null)).toBe(true)
  })
})

describe('campaign safety', () => {
  it('skips someone who sends STOP after the list was made', async () => {
    await audience()
    const { campaign, template } = await scheduledCampaign()
    await processCampaign(h.deps, { orgId: h.org.id, campaignId: campaign.id }) // first 25
    await h.db
      .update(contacts)
      .set({ optInStatus: 'opted_out' })
      .where(eq(contacts.waId, phone(40)))
    h.queues.campaign.jobs.length = 0
    await processCampaign(h.deps, { orgId: h.org.id, campaignId: campaign.id })
    expect(h.queues.outbound.jobs).toHaveLength(49)
    const [c] = await h.db.select().from(campaigns).where(eq(campaigns.id, campaign.id))
    expect((await campaignResults(h.db, c!, template)).skipped).toBe(1)
  })

  it('a retried batch sends nobody twice', async () => {
    await audience()
    const { campaign } = await scheduledCampaign()
    const job = { orgId: h.org.id, campaignId: campaign.id }
    await processCampaign(h.deps, job)
    await processCampaign(h.deps, job) // as if BullMQ ran the first one again
    await processCampaign(h.deps, job)
    const ids = h.queues.outbound.jobs.map((j) => j.data.messageId)
    expect(ids).toHaveLength(50)
    expect(new Set(ids).size).toBe(50)
    expect(await h.db.$count(messages, eq(messages.sentBy, 'campaign'))).toBe(50)
  })

  it('stops when cancelled between batches', async () => {
    await audience()
    const { campaign } = await scheduledCampaign()
    await processCampaign(h.deps, { orgId: h.org.id, campaignId: campaign.id })
    await h.db.update(campaigns).set({ status: 'cancelled' }).where(eq(campaigns.id, campaign.id))
    await processCampaign(h.deps, { orgId: h.org.id, campaignId: campaign.id })
    expect(h.queues.outbound.jobs).toHaveLength(25)
  })

  it('waits for 8 AM instead of messaging at night', async () => {
    await audience()
    const { campaign } = await scheduledCampaign()
    h.setNow(new Date('2026-09-26T17:00:00Z')) // 10:30 PM IST
    const result = await processCampaign(h.deps, { orgId: h.org.id, campaignId: campaign.id })
    expect(result).toMatchObject({ sent: 0, reason: 'quiet_hours' })
    expect(h.queues.outbound.jobs).toHaveLength(0)
    // 8 AM IST next day = 02:30 UTC.
    expect(h.queues.campaign.jobs[0]?.opts?.delay).toBe(
      new Date('2026-09-27T02:30:00Z').getTime() - new Date('2026-09-26T17:00:00Z').getTime(),
    )
  })

  it('stops if Meta paused the template after it was scheduled', async () => {
    await audience()
    const { campaign, template } = await scheduledCampaign()
    await h.db.update(templates).set({ status: 'paused' }).where(eq(templates.id, template.id))
    await processCampaign(h.deps, { orgId: h.org.id, campaignId: campaign.id })
    const [c] = await h.db.select().from(campaigns).where(eq(campaigns.id, campaign.id))
    expect(c?.status).toBe('cancelled')
    expect(h.queues.outbound.jobs).toHaveLength(0)
  })

  it('credits an enquiry that answers the campaign to it', async () => {
    await audience()
    const { campaign } = await scheduledCampaign()
    await processCampaign(h.deps, { orgId: h.org.id, campaignId: campaign.id })
    for (const job of h.queues.outbound.jobs.splice(0, 1)) await processOutbound(h.deps, job.data)
    h.setNow(new Date('2026-09-26T08:00:00Z'))
    await processInbound(h.deps, {
      payload: inboundText({
        id: 'wamid.REPLY1',
        from: phone(0),
        body: 'Details bhejo',
        ts: 1790409600,
      }),
    })
    h.deps.models = null
    for (const job of h.queues.aiReply.jobs.splice(0)) await processAiReply(h.deps, job.data)
    const [lead] = await h.db
      .select({ source: leads.source })
      .from(leads)
      .innerJoin(contacts, eq(contacts.id, leads.contactId))
      .where(eq(contacts.waId, phone(0)))
    expect(lead?.source).toBe('campaign')
  })
})

describe('templates from Meta', () => {
  it('a review result by webhook approves the template and tells the dashboard', async () => {
    const [t] = await h.db
      .update(templates)
      .set({ status: 'pending', metaTemplateId: '1689556908129832' })
      .where(
        and(
          eq(templates.orgId, h.org.id),
          eq(templates.name, 'fee_due'),
          eq(templates.language, 'hi'),
        ),
      )
      .returning()
    await processInbound(h.deps, {
      payload: {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: WABA_ID,
            changes: [
              {
                field: 'message_template_status_update',
                value: {
                  event: 'REJECTED',
                  message_template_id: 1689556908129832,
                  message_template_name: 'fee_due',
                  message_template_language: 'hi',
                  reason: 'INVALID_FORMAT',
                },
              },
            ],
          },
        ],
      },
    })
    const [after] = await h.db.select().from(templates).where(eq(templates.id, t!.id))
    expect(after).toMatchObject({ status: 'rejected', rejectionReason: 'INVALID_FORMAT' })
    expect(h.emitted.some((e) => e.event === 'template:updated' && e.orgId === h.org.id)).toBe(true)
  })

  it('the 15-minute poll catches what a webhook missed and adds templates made at Meta', async () => {
    graph.templates.push(
      { id: 'm-1', name: 'fee_due', language: 'hi', status: 'APPROVED', category: 'UTILITY' },
      {
        id: 'm-2',
        name: 'holi_offer',
        language: 'hi',
        status: 'APPROVED',
        category: 'MARKETING',
        components: [{ type: 'BODY', text: 'Holi par 10% chhoot!', example: { body_text: [] } }],
      },
    )
    const result = await processTemplateSync(h.deps, {})
    expect(result.changed).toBe(2)
    const rows = await h.db.select().from(templates).where(eq(templates.orgId, h.org.id))
    expect(rows.find((r) => r.name === 'fee_due' && r.language === 'hi')).toMatchObject({
      status: 'approved',
      metaTemplateId: 'm-1',
    })
    expect(rows.find((r) => r.name === 'holi_offer')).toMatchObject({
      status: 'approved',
      category: 'marketing',
      components: [{ type: 'BODY', text: 'Holi par 10% chhoot!' }],
    })
  })
})

describe('the owner’s 8 PM summary', () => {
  async function ownerWantsIt() {
    const [owner] = await h.db
      .select({ id: users.id })
      .from(users)
      .innerJoin(memberships, eq(memberships.userId, users.id))
      .where(and(eq(memberships.orgId, h.org.id), eq(memberships.role, 'owner')))
    await h.db.update(users).set({ phone: '919829012345' }).where(eq(users.id, owner!.id))
    await h.db
      .update(memberships)
      .set({ notifyPrefs: { dailySummary: true } })
      .where(and(eq(memberships.orgId, h.org.id), eq(memberships.userId, owner!.id)))
    await h.db
      .update(templates)
      .set({ status: 'approved' })
      .where(and(eq(templates.orgId, h.org.id), eq(templates.purpose, 'daily_summary')))
  }

  it('sends the day’s numbers once, and the owner never joins a campaign audience', async () => {
    await ownerWantsIt()
    await processSummary(h.deps, { orgId: h.org.id, day: '2026-09-26' })
    await processSummary(h.deps, { orgId: h.org.id, day: '2026-09-26' }) // a retry
    expect(h.queues.outbound.jobs).toHaveLength(1)
    const [m] = await h.db.select().from(messages).where(eq(messages.sentBy, 'system'))
    expect(m?.interactive).toMatchObject({
      content: { kind: 'template', name: 'daily_summary_hinglish' },
    })
    const [contact] = await h.db.select().from(contacts).where(eq(contacts.waId, '919829012345'))
    expect(contact?.optInSource).toBe(TEAM_OPT_IN_SOURCE)
    expect((await audienceCount(h.db, h.org.id, {})).count).toBe(0)
  })

  it('the 8 PM run fans out one job per active org and day', async () => {
    await processSummary(h.deps, {})
    await processSummary(h.deps, {}) // a retry of the 8 PM job adds nothing
    expect(h.queues.summary.jobs.map((j) => j.opts?.jobId)).toContain(
      `summary-${h.org.id}-2026-09-26`,
    )
    expect(new Set(h.queues.summary.jobs.map((j) => j.opts?.jobId)).size).toBe(
      h.queues.summary.jobs.length,
    )
  })
})
