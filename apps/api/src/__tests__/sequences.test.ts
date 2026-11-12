import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sequenceSteps, sequences, templates } from '@haazir/db'
import { createTestApp } from './helpers'

let t: Awaited<ReturnType<typeof createTestApp>>
beforeAll(async () => {
  t = await createTestApp()
})
afterAll(() => t.close())

const api = (path: string) => `/api/v1${path}`
const approve = async (orgId: string, name: string) =>
  (
    await t.db
      .update(templates)
      .set({ status: 'approved', metaTemplateId: `meta-${name}` })
      .where(and(eq(templates.orgId, orgId), eq(templates.name, name)))
      .returning()
  )[0]!

describe('follow-up sequences', () => {
  it('owners see the three sequences, off and empty, with the templates a sequence can fill', async () => {
    const followup = await approve(t.orgA.org.id, 'followup_hinglish')
    // Needs a date: a sequence can't fill it, so it isn't offered.
    await approve(t.orgA.org.id, 'announcement_hinglish')

    const staff = await t.login(t.users.staff)
    expect((await staff.get(api('/sequences'))).status).toBe(403)

    const owner = await t.login(t.users.owner)
    const res = await owner.get(api('/sequences'))
    expect(res.status).toBe(200)
    expect(res.body.sequences.map((s: { trigger: string }) => s.trigger)).toEqual([
      'no_demo',
      'demo_missed',
      'demo_no_admission',
    ])
    expect(res.body.sequences.every((s: { enabled: boolean }) => !s.enabled)).toBe(true)
    expect(res.body.templates.map((x: { id: string }) => x.id)).toEqual([followup.id])
    expect(res.body.maxSteps).toBe(3)
  })

  it('saves steps, shows the most it can cost per lead, and starts the clock when switched on', async () => {
    const followup = await approve(t.orgA.org.id, 'followup_hinglish')
    const owner = await t.login(t.users.owner)
    const saved = await owner.put(api('/sequences/no_demo')).send({
      enabled: false,
      steps: [
        { delayHours: 24, templateId: followup.id },
        { delayHours: 72, templateId: followup.id },
      ],
    })
    expect(saved.status).toBe(200)
    // Two marketing messages at the seeded ₹0.8631 each.
    expect(saved.body).toMatchObject({ enabled: false, maxCostPaisePerLead: 173 })
    expect(saved.body.steps).toEqual([
      { delayHours: 24, templateId: followup.id, usable: true },
      { delayHours: 72, templateId: followup.id, usable: true },
    ])
    const [off] = await t.db.select().from(sequences).where(eq(sequences.orgId, t.orgA.org.id))
    expect(off).toMatchObject({ enabled: false, enabledAt: null })

    const on = await owner
      .put(api('/sequences/no_demo'))
      .send({ enabled: true, steps: [{ delayHours: 24, templateId: followup.id }] })
    expect(on.body).toMatchObject({ enabled: true, maxCostPaisePerLead: 86 })
    const [row] = await t.db.select().from(sequences).where(eq(sequences.orgId, t.orgA.org.id))
    expect(row!.enabledAt).toBeInstanceOf(Date)
    expect(await t.db.$count(sequenceSteps, eq(sequenceSteps.sequenceId, row!.id))).toBe(1)

    // Saving again while on keeps the original start: old leads stay out.
    await owner
      .put(api('/sequences/no_demo'))
      .send({ enabled: true, steps: [{ delayHours: 30, templateId: followup.id }] })
    const [again] = await t.db.select().from(sequences).where(eq(sequences.orgId, t.orgA.org.id))
    expect(again!.enabledAt).toEqual(row!.enabledAt)
  })

  it('refuses what could not be sent', async () => {
    const followup = await approve(t.orgA.org.id, 'followup_hinglish')
    const dated = await approve(t.orgA.org.id, 'announcement_hinglish')
    const [draft] = await t.db
      .select()
      .from(templates)
      .where(and(eq(templates.orgId, t.orgA.org.id), eq(templates.status, 'draft')))
      .limit(1)
    const owner = await t.login(t.users.owner)
    const put = (body: object) => owner.put(api('/sequences/demo_missed')).send(body)
    const reason = (res: { body: { error: { details?: { reason?: string } } } }) =>
      res.body.error.details?.reason

    expect(reason(await put({ enabled: true, steps: [] }))).toBe('no_steps')
    expect(
      reason(await put({ enabled: false, steps: [{ delayHours: 5, templateId: dated.id }] })),
    ).toBe('unfillable')
    expect(
      reason(await put({ enabled: false, steps: [{ delayHours: 5, templateId: draft!.id }] })),
    ).toBe('not_approved')
    expect(
      reason(
        await put({
          enabled: false,
          steps: [
            { delayHours: 48, templateId: followup.id },
            { delayHours: 24, templateId: followup.id },
          ],
        }),
      ),
    ).toBe('step_order')
    const four = Array.from({ length: 4 }, (_, i) => ({
      delayHours: 24 * (i + 1),
      templateId: followup.id,
    }))
    expect((await put({ enabled: false, steps: four })).status).toBe(400)
    expect(
      (await owner.put(api('/sequences/whenever')).send({ enabled: false, steps: [] })).status,
    ).toBe(400)
  })

  it("another org's template can't be used, and its sequences are never listed", async () => {
    const theirs = await approve(t.orgB.org.id, 'followup_hinglish')
    await t.db.insert(sequences).values({ orgId: t.orgB.org.id, trigger: 'no_demo', enabled: true })
    const owner = await t.login(t.users.owner)
    const res = await owner
      .put(api('/sequences/demo_no_admission'))
      .send({ enabled: false, steps: [{ delayHours: 24, templateId: theirs.id }] })
    expect(res.status).toBe(404)
    const list = await owner.get(api('/sequences'))
    expect(list.body.templates.map((x: { id: string }) => x.id)).not.toContain(theirs.id)
    const [b] = await t.db.select().from(sequences).where(eq(sequences.orgId, t.orgB.org.id))
    expect(b).toMatchObject({ enabled: true })
  })
})
