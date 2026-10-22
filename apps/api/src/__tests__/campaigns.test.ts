import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { campaigns, contacts, courses, leads, templates } from '@haazir/db'
import { GraphError, type GraphClient, type MetaTemplate, type NewTemplate } from '@haazir/whatsapp'
import { createTestApp } from './helpers'

/** Meta's template endpoints, recorded. */
const meta = {
  created: [] as NewTemplate[],
  edited: [] as string[],
  deleted: [] as string[],
  remote: [] as MetaTemplate[],
  refuseNext: null as GraphError | null,
}
const fakeGraph = {
  async createTemplate(_waba: string, t: NewTemplate) {
    if (meta.refuseNext) {
      const err = meta.refuseNext
      meta.refuseNext = null
      throw err
    }
    meta.created.push(t)
    return {
      id: `meta-${meta.created.length}`,
      status: 'PENDING',
      category: t.category.toUpperCase(),
    }
  },
  async editTemplate(id: string) {
    meta.edited.push(id)
  },
  async listTemplates() {
    return meta.remote
  },
  async deleteTemplate(_waba: string, _name: string, id: string) {
    meta.deleted.push(id)
  },
} as unknown as GraphClient

let t: Awaited<ReturnType<typeof createTestApp>>
beforeAll(async () => {
  t = await createTestApp({ graph: () => fakeGraph })
})
afterAll(() => t.close())
beforeEach(() => {
  meta.created.length = 0
  meta.edited.length = 0
  meta.deleted.length = 0
  meta.remote.length = 0
})

const api = (path: string) => `/api/v1${path}`

describe('templates (spec §16.9)', () => {
  it('lists the seeded set as drafts that already pass Meta’s rules; agents can’t open it', async () => {
    const owner = await t.login(t.users.owner)
    const res = await owner.get(api('/templates'))
    expect(res.status).toBe(200)
    expect(res.body.hasNumber).toBe(true)
    expect(res.body.templates).toHaveLength(27) // 9 messages × hi, Hinglish, en
    expect(res.body.templates.every((x: { problems: string[] }) => !x.problems.length)).toBe(true)
    const staff = await t.login(t.users.staff)
    expect((await staff.get(api('/templates'))).status).toBe(403)
  })

  it('creates a draft with Meta’s name, refuses to submit what Meta would reject, then submits', async () => {
    const owner = await t.login(t.users.owner)
    const created = await owner.post(api('/templates')).send({
      name: 'Diwali Offer 2026',
      language: 'hi',
      category: 'marketing',
      body: '{{1}} ji, Diwali par 10% chhoot!',
      variables: ['contact_name'],
    })
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({
      name: 'diwali_offer_2026',
      status: 'draft',
      problems: ['variable_at_edge'],
    })
    const refused = await owner.post(api(`/templates/${created.body.id}/submit`))
    expect(refused.status).toBe(400)
    expect(refused.body.error.details.problems).toEqual(['variable_at_edge'])
    expect(meta.created).toHaveLength(0)

    await owner
      .patch(api(`/templates/${created.body.id}`))
      .send({ body: 'Namaste {{1}} ji, Diwali par 10% chhoot!', footer: 'Reply STOP to opt out' })
    const submitted = await owner.post(api(`/templates/${created.body.id}/submit`))
    expect(submitted.status).toBe(200)
    expect(submitted.body).toMatchObject({ status: 'pending', submitted: true })
    expect(meta.created[0]).toMatchObject({
      name: 'diwali_offer_2026',
      category: 'marketing',
      components: [
        { type: 'BODY', example: { body_text: [['Anil']] } },
        { type: 'FOOTER', text: 'Reply STOP to opt out' },
      ],
    })
    // Once with Meta it can't be edited here.
    const edit = await owner.patch(api(`/templates/${created.body.id}`)).send({ body: 'x {{1}} y' })
    expect(edit.status).toBe(400)

    // Deleting it removes it at Meta too.
    expect((await owner.delete(api(`/templates/${created.body.id}`))).status).toBe(204)
    expect(meta.deleted).toEqual(['meta-1'])
  })

  it('shows Meta’s own reason when it refuses a submission', async () => {
    const owner = await t.login(t.users.owner)
    const created = await owner.post(api('/templates')).send({
      name: 'clash',
      language: 'en',
      category: 'utility',
      body: 'Your class is at 5 pm today.',
    })
    meta.refuseNext = new GraphError(
      400,
      100,
      'Invalid parameter',
      'Content in this language already exists',
    )
    const res = await owner.post(api(`/templates/${created.body.id}/submit`))
    expect(res.status).toBe(400)
    expect(res.body.error.message).toBe('Content in this language already exists')
  })

  it('keeps reminder templates: they can be edited as drafts but not deleted', async () => {
    const owner = await t.login(t.users.owner)
    const [feeDue] = await t.db
      .select()
      .from(templates)
      .where(and(eq(templates.orgId, t.orgA.org.id), eq(templates.purpose, 'fee_due')))
      .limit(1)
    const res = await owner.delete(api(`/templates/${feeDue!.id}`))
    expect(res.status).toBe(400)
    expect(res.body.error.details.reason).toBe('automation_template')
  })

  it('syncs statuses from Meta', async () => {
    const owner = await t.login(t.users.owner)
    meta.remote.push({
      id: 'meta-x',
      name: 'payment_received',
      language: 'hi',
      status: 'APPROVED',
      category: 'UTILITY',
    })
    const res = await owner.post(api('/templates/sync'))
    expect(res.body).toEqual({ changed: 1, added: 0 })
    const [row] = await t.db
      .select()
      .from(templates)
      .where(
        and(
          eq(templates.orgId, t.orgA.org.id),
          eq(templates.name, 'payment_received'),
          eq(templates.language, 'hi'),
        ),
      )
    expect(row).toMatchObject({ status: 'approved', metaTemplateId: 'meta-x' })
  })
})

describe('campaigns (spec §16.8)', () => {
  let announcementId: string
  beforeAll(async () => {
    const org = t.orgA.org.id
    await t.db.insert(contacts).values([
      ...Array.from({ length: 12 }, (_, i) => ({
        orgId: org,
        waId: `91987650${String(i).padStart(4, '0')}`,
        name: `Parent ${i}`,
        tags: ['parent'],
        optInStatus: 'opted_in' as const,
      })),
      { orgId: org, waId: '919876509998', tags: ['parent'], optInStatus: 'opted_out' as const },
      { orgId: org, waId: '919876509999', tags: ['parent'], optInStatus: 'unknown' as const },
    ])
    const [a] = await t.db
      .update(templates)
      .set({ status: 'approved' })
      .where(and(eq(templates.orgId, org), eq(templates.name, 'announcement_hinglish')))
      .returning()
    announcementId = a!.id
  })

  it('counts the audience live: opted-in only, saying who was left out', async () => {
    const owner = await t.login(t.users.owner)
    const res = await owner
      .post(api('/campaigns/audience-count'))
      .send({ audience: { tags: ['parent'] } })
    expect(res.body).toEqual({ count: 12, optedOut: 1, noConsent: 1 })
  })

  it('narrows by lead stage and course, matching the right people', async () => {
    const owner = await t.login(t.users.owner)
    const org = t.orgA.org.id
    const [rscit] = await t.db
      .select()
      .from(courses)
      .where(and(eq(courses.orgId, org), eq(courses.shortName, 'RS-CIT')))
    const parents = await t.db
      .select()
      .from(contacts)
      .where(and(eq(contacts.orgId, org), eq(contacts.optInStatus, 'opted_in')))
      .orderBy(contacts.waId)
      .limit(3)
    await t.db.insert(leads).values([
      { orgId: org, contactId: parents[0]!.id, stage: 'demo_done', courseId: rscit!.id },
      { orgId: org, contactId: parents[1]!.id, stage: 'demo_done' },
      { orgId: org, contactId: parents[2]!.id, stage: 'new', courseId: rscit!.id },
    ])
    const count = async (audience: object) =>
      (await owner.post(api('/campaigns/audience-count')).send({ audience })).body.count
    expect(await count({ stages: ['demo_done'] })).toBe(2)
    expect(await count({ courseIds: [rscit!.id] })).toBe(2)
    expect(await count({ stages: ['demo_done'], courseIds: [rscit!.id] })).toBe(1)
    expect(await count({ stages: ['admitted'] })).toBe(0)
    await t.db.delete(leads).where(eq(leads.orgId, org))
  })

  it('estimates, previews for a real person, and schedules (night becomes 8 AM)', async () => {
    const owner = await t.login(t.users.owner)
    const draft = await owner.post(api('/campaigns')).send({
      name: 'Naya batch',
      templateId: announcementId,
      audience: { tags: ['parent'] },
      variableMap: [
        { source: 'custom', text: 'RS-CIT Shaam' },
        { source: 'custom', text: '1 Nov' },
      ],
    })
    expect(draft.status).toBe(201)
    const id = draft.body.id

    const estimate = await owner.post(api(`/campaigns/${id}/estimate`))
    expect(estimate.body).toMatchObject({
      count: 12,
      recipients: 12,
      category: 'marketing',
      rateCentipaise: 8631,
      costPaise: 1036, // 12 × ₹0.8631 = ₹10.3572
      gstPaise: 186,
    })

    const preview = await owner.get(api(`/campaigns/${id}/preview`))
    expect(preview.body.text).toBe(
      'Naya batch RS-CIT Shaam, 1 Nov se shuru. Seats limited. Details ke liye reply karein.',
    )
    expect(preview.body.contact.name).toMatch(/^Parent /)

    // 10:30 PM IST tomorrow → it starts at 8 AM the day after.
    const tomorrow = new Date(Date.now() + 86_400_000)
    const ist = new Date(tomorrow.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10)
    const scheduled = await owner
      .post(api(`/campaigns/${id}/schedule`))
      .send({ at: `${ist}T22:30:00+05:30` })
    expect(scheduled.status).toBe(200)
    const next = new Date(new Date(`${ist}T00:00:00Z`).getTime() + 86_400_000)
      .toISOString()
      .slice(0, 10)
    expect(new Date(scheduled.body.scheduledAt).toISOString()).toBe(
      new Date(`${next}T08:00:00+05:30`).toISOString(),
    )
    expect(scheduled.body).toMatchObject({
      status: 'scheduled',
      estimatedRecipients: 12,
      estimatedCostPaise: 1036,
    })
    const job = t.rec.campaign.find((j) => j.data.campaignId === id)
    expect(job?.opts?.jobId).toBe(`campaign-${id}-start`)
    expect(job?.opts?.delay).toBeGreaterThan(0)

    // Scheduled campaigns can't be edited; they can be stopped.
    expect((await owner.patch(api(`/campaigns/${id}`)).send({ name: 'x' })).status).toBe(400)
    const cancelled = await owner.post(api(`/campaigns/${id}/cancel`))
    expect(cancelled.body.status).toBe('cancelled')
  })

  it('refuses to send a template Meta hasn’t approved, or with a {{n}} left empty', async () => {
    const owner = await t.login(t.users.owner)
    const [draftTemplate] = await t.db
      .select()
      .from(templates)
      .where(and(eq(templates.orgId, t.orgA.org.id), eq(templates.name, 'followup')))
      .limit(1)
    const a = await owner
      .post(api('/campaigns'))
      .send({ name: 'x', templateId: draftTemplate!.id, audience: { tags: ['parent'] } })
    const notApproved = await owner.post(api(`/campaigns/${a.body.id}/schedule`)).send({})
    expect(notApproved.status).toBe(409)
    expect(notApproved.body.error.code).toBe('TEMPLATE_NOT_APPROVED')

    const b = await owner.post(api('/campaigns')).send({
      name: 'y',
      templateId: announcementId,
      audience: { tags: ['parent'] },
      variableMap: [{ source: 'custom', text: 'RS-CIT' }],
    })
    const missing = await owner.post(api(`/campaigns/${b.body.id}/schedule`)).send({})
    expect(missing.status).toBe(400)
    expect(missing.body.error.details.reason).toBe('variables_missing')
  })

  it('lists campaigns with their numbers; agents can’t reach campaigns at all', async () => {
    const owner = await t.login(t.users.owner)
    const list = await owner.get(api('/campaigns'))
    expect(list.body.campaigns.length).toBeGreaterThanOrEqual(1)
    expect(list.body.campaigns[0]).toHaveProperty('stats')
    const staff = await t.login(t.users.staff)
    expect((await staff.get(api('/campaigns'))).status).toBe(403)
    expect((await staff.post(api('/campaigns/audience-count')).send({ audience: {} })).status).toBe(
      403,
    )
    expect(await t.db.$count(campaigns, eq(campaigns.orgId, t.orgB.org.id))).toBe(0)
  })
})

describe('templates in Chat, once the 24-hour window has closed', () => {
  it('offers approved ones with the person’s name filled in, and sends one as staff', async () => {
    const org = t.orgA.org.id
    await t.db
      .update(templates)
      .set({ status: 'approved' })
      .where(and(eq(templates.orgId, org), eq(templates.name, 'followup_hinglish')))
    const staff = await t.login(t.users.staff)
    const id = t.orgA.conversation.id
    const list = await staff.get(api(`/conversations/${id}/templates`))
    const followup = list.body.templates.find(
      (x: { name: string }) => x.name === 'followup_hinglish',
    )
    expect(followup.suggested).toEqual(['Contact 919811111111'])

    expect(
      (
        await staff
          .post(api(`/conversations/${id}/template`))
          .send({ templateId: followup.id, values: [] })
      ).status,
    ).toBe(400)
    const sent = await staff
      .post(api(`/conversations/${id}/template`))
      .send({ templateId: followup.id, values: ['Ravi'] })
    expect(sent.status).toBe(201)
    expect(sent.body.body).toBe(
      'Namaste Ravi ji, demo kaisi lagi? Admission ya koi sawaal ho to reply karein.',
    )
    const draft = list.body.templates.length
    const [notApproved] = await t.db
      .select()
      .from(templates)
      .where(and(eq(templates.orgId, org), eq(templates.status, 'draft')))
      .limit(1)
    expect(draft).toBeGreaterThan(0)
    const refused = await staff
      .post(api(`/conversations/${id}/template`))
      .send({ templateId: notApproved!.id, values: [] })
    expect(refused.status).toBe(409)
  })
})

describe('consent (spec §19)', () => {
  it('staff record a yes with source and time; a STOP stands', async () => {
    const staff = await t.login(t.users.staff)
    const yes = await staff.patch(api(`/contacts/${t.orgA.contact.id}`)).send({ optIn: true })
    expect(yes.body).toMatchObject({ optInStatus: 'opted_in', optInSource: 'staff' })
    expect(yes.body.optInAt).toBeTruthy()
    const no = await staff.patch(api(`/contacts/${t.orgA.contact.id}`)).send({ optIn: false })
    expect(no.body.optInStatus).toBe('opted_out')
    const again = await staff.patch(api(`/contacts/${t.orgA.contact.id}`)).send({ optIn: true })
    expect(again.status).toBe(400)
    expect(again.body.error.details.reason).toBe('opted_out')
  })
})

describe('reports (spec §16.12)', () => {
  it('returns tiles, a day-by-day series, funnel, heatmap and costs; owners only', async () => {
    const owner = await t.login(t.users.owner)
    const res = await owner.get(api('/analytics/report?days=7'))
    expect(res.status).toBe(200)
    expect(res.body.enquiriesPerDay).toHaveLength(7)
    expect(res.body.tiles).toHaveProperty('messageCostPaise')
    expect(res.body.tiles).toHaveProperty('medianFirstReplySeconds')
    expect(res.body).toHaveProperty('funnel.enquiries')
    expect(Array.isArray(res.body.heatmap)).toBe(true)
    expect((await owner.get(api('/analytics/report?days=12'))).status).toBe(400)
    const staff = await t.login(t.users.staff)
    expect((await staff.get(api('/analytics/report'))).status).toBe(403)
  })
})

describe('Meta’s rate card (super admin)', () => {
  it('adds a rate from a date; today’s rates follow it', async () => {
    const admin = await t.login(t.users.superAdmin)
    const before = await admin.get(api('/admin/meta-rates'))
    expect(before.body.current.marketing).toBe(8631)
    const set = await admin
      .post(api('/admin/meta-rates'))
      .send({ category: 'marketing', priceRupees: '0.9', effectiveFrom: '2026-01-02' })
    expect(set.status).toBe(201)
    expect(set.body.priceCentipaise).toBe(9000)
    // The seeded 2026-07-01 card is newer, so it still applies today.
    expect((await admin.get(api('/admin/meta-rates'))).body.current.marketing).toBe(8631)
    const owner = await t.login(t.users.owner)
    expect((await owner.get(api('/admin/meta-rates'))).status).toBe(403)
  })
})
