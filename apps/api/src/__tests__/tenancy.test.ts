import request from 'supertest'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  auditLogs,
  conversations,
  knowledgeFaqs,
  knowledgeSources,
  unansweredQuestions,
} from '@haazir/db'
import { createTestApp, ORIGIN } from './helpers'

let t: Awaited<ReturnType<typeof createTestApp>>
beforeAll(async () => {
  t = await createTestApp()
})
afterAll(() => t.close())

describe('auth', () => {
  it('logs in with email and password and knows who you are', async () => {
    const owner = await t.login(t.users.owner)
    const me = await owner.get('/api/v1/me')
    expect(me.status).toBe(200)
    expect(me.body.user).toMatchObject({ email: t.users.owner, isSuperAdmin: false })
    expect(me.body.orgs).toEqual([expect.objectContaining({ id: t.orgA.org.id, role: 'owner' })])
  })

  it('refuses a wrong password, and requests without a session', async () => {
    const res = await request(t.app)
      .post('/api/v1/auth/sign-in/email')
      .set('origin', ORIGIN)
      .send({ email: t.users.owner, password: 'wrong-password' })
    expect(res.status).toBe(401)
    expect((await request(t.app).get('/api/v1/me')).status).toBe(401)
    expect((await request(t.app).get('/api/v1/conversations')).status).toBe(401)
  })

  it('does not allow public sign-up: accounts come from invites', async () => {
    const res = await request(t.app)
      .post('/api/v1/auth/sign-up/email')
      .set('origin', ORIGIN)
      .send({ email: 'stranger@example.com', password: 'password123', name: 'Stranger' })
    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})

describe('invites', () => {
  it('super admin creates an org; the owner accepts the invite and is logged in as owner', async () => {
    const admin = await t.login(t.users.superAdmin)
    const created = await admin.post('/api/v1/admin/orgs').send({
      name: 'Naya Institute',
      city: 'Jhunjhunu',
      ownerName: 'Mohan Lal',
      ownerEmail: 'mohan@naya.example',
    })
    expect(created.status).toBe(201)
    const token = created.body.inviteUrl.split('/invite/')[1]

    const info = await request(t.app).get(`/api/v1/invites/${token}`)
    expect(info.body).toMatchObject({
      orgName: 'Naya Institute',
      email: 'mohan@naya.example',
      role: 'owner',
      hasAccount: false,
    })

    const newOwner = request.agent(t.app)
    const accepted = await newOwner
      .post(`/api/v1/invites/${token}/accept`)
      .set('origin', ORIGIN)
      .send({ password: 'naya-password-1', uiLanguage: 'hi' })
    expect(accepted.status).toBe(201)
    const me = await newOwner.get('/api/v1/me')
    expect(me.body.orgs).toEqual([
      expect.objectContaining({ name: 'Naya Institute', role: 'owner' }),
    ])

    // One use only.
    expect((await request(t.app).get(`/api/v1/invites/${token}`)).status).toBe(404)
  })

  it('an owner invites staff; only owners can invite owners', async () => {
    const owner = await t.login(t.users.owner)
    const res = await owner
      .post('/api/v1/members')
      .send({ email: 'ramesh@shiksha.example', role: 'agent' })
    expect(res.status).toBe(201)
    expect(res.body.inviteUrl).toMatch(/\/invite\//)

    const staff = await t.login(t.users.staff)
    expect(
      (await staff.post('/api/v1/members').send({ email: 'x@y.example', role: 'agent' })).status,
    ).toBe(403)
  })
})

describe('tenant isolation: org A can never see or change org B', () => {
  it('lists only its own conversations', async () => {
    const owner = await t.login(t.users.owner)
    const res = await owner.get('/api/v1/conversations')
    expect(res.body.conversations.map((c: { id: string }) => c.id)).toEqual([
      t.orgA.conversation.id,
    ])
  })

  it("treats another org's ids as not found, for every resource", async () => {
    const owner = await t.login(t.users.owner)
    const b = t.orgB
    const [faqB] = await t.db
      .select()
      .from(knowledgeFaqs)
      .where(eq(knowledgeFaqs.orgId, b.org.id))
      .limit(1)
    const [sourceB] = await t.db
      .select()
      .from(knowledgeSources)
      .where(eq(knowledgeSources.orgId, b.org.id))
      .limit(1)
    const [unansweredB] = await t.db
      .insert(unansweredQuestions)
      .values({ orgId: b.org.id, question: 'Hostel?', normalized: 'hostel' })
      .returning()

    const attempts = [
      owner.get(`/api/v1/conversations/${b.conversation.id}`),
      owner.get(`/api/v1/conversations/${b.conversation.id}/messages`),
      owner.post(`/api/v1/conversations/${b.conversation.id}/messages`).send({ text: 'hi' }),
      owner.post(`/api/v1/conversations/${b.conversation.id}/takeover`),
      owner.post(`/api/v1/conversations/${b.conversation.id}/handback`),
      owner.patch(`/api/v1/conversations/${b.conversation.id}`).send({ assignedUserId: null }),
      owner.get(`/api/v1/contacts/${b.contact.id}`),
      owner.patch(`/api/v1/contacts/${b.contact.id}`).send({ notes: 'x' }),
      owner.delete(`/api/v1/knowledge/sources/${sourceB!.id}`),
      owner.patch(`/api/v1/knowledge/faqs/${faqB!.id}`).send({ answer: 'hacked' }),
      owner.delete(`/api/v1/knowledge/faqs/${faqB!.id}`),
      owner.post(`/api/v1/knowledge/unanswered/${unansweredB!.id}/resolve`).send({ answer: 'x' }),
      owner.get(`/api/v1/media/${b.message.id}`),
    ]
    const results = await Promise.all(attempts)
    results.forEach((res, i) => expect(res.status, `attempt ${i + 1}`).toBe(404))
    // And nothing of B's changed.
    const [convB] = await t.db
      .select()
      .from(conversations)
      .where(eq(conversations.id, b.conversation.id))
    expect(convB?.mode).toBe('bot')
    expect(t.rec.outbound).toHaveLength(0)
  })

  it("refuses to act for an org you're not a member of, even when asked by header", async () => {
    const owner = await t.login(t.users.owner)
    const res = await owner.get('/api/v1/conversations').set('x-org-id', t.orgB.org.id)
    expect(res.status).toBe(403)
  })

  it("each org's lists contain only its own knowledge and bot settings", async () => {
    const ownerB = await t.login(t.users.secondOwner)
    const faqs = await ownerB.get('/api/v1/knowledge/faqs')
    const ids = new Set(faqs.body.faqs.map((f: { sourceId: string }) => f.sourceId))
    const bSources = (
      await t.db.select().from(knowledgeSources).where(eq(knowledgeSources.orgId, t.orgB.org.id))
    ).map((s) => s.id)
    for (const id of ids) expect(bSources).toContain(id)
    const bot = await ownerB.get('/api/v1/bot')
    expect(bot.body.orgId).toBe(t.orgB.org.id)
  })

  it('live events go only to the org they belong to', async () => {
    t.rec.events.length = 0
    const owner = await t.login(t.users.owner)
    await owner.post(`/api/v1/conversations/${t.orgA.conversation.id}/takeover`)
    expect(t.rec.events.length).toBeGreaterThan(0)
    expect(t.rec.events.every((e) => e.orgId === t.orgA.org.id)).toBe(true)
  })
})

describe('the inbox', () => {
  it('staff reply: queued through the outbound gate, the chat taken over, announced live', async () => {
    t.rec.outbound.length = 0
    t.rec.events.length = 0
    const staff = await t.login(t.users.staff)
    const res = await staff
      .post(`/api/v1/conversations/${t.orgA.conversation.id}/messages`)
      .send({ text: 'Ji, fees ₹4,500 hai.' })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      direction: 'out',
      sentBy: 'user',
      status: 'queued',
      body: 'Ji, fees ₹4,500 hai.',
    })
    expect(t.rec.outbound).toEqual([{ messageId: res.body.id }])
    expect(t.rec.events.map((e) => e.event)).toEqual(['message:new', 'conversation:updated'])

    const [conv] = await t.db
      .select()
      .from(conversations)
      .where(eq(conversations.id, t.orgA.conversation.id))
    expect(conv?.mode).toBe('human')
    expect(conv!.humanUntil!.getTime()).toBeGreaterThan(Date.now() + 60 * 60 * 1000)
  })

  it('refuses a free-form reply once the 24h window has closed', async () => {
    await t.db
      .update(conversations)
      .set({ serviceWindowExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(conversations.id, t.orgA.conversation.id))
    const staff = await t.login(t.users.staff)
    const res = await staff
      .post(`/api/v1/conversations/${t.orgA.conversation.id}/messages`)
      .send({ text: 'Hello?' })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('WINDOW_CLOSED')
    await t.db
      .update(conversations)
      .set({ serviceWindowExpiresAt: new Date(Date.now() + 3_600_000) })
      .where(eq(conversations.id, t.orgA.conversation.id))
  })

  it('takeover and handback flip the mode, and both are audit-logged', async () => {
    const staff = await t.login(t.users.staff)
    const taken = await staff.post(`/api/v1/conversations/${t.orgA.conversation.id}/takeover`)
    expect(taken.body.mode).toBe('human')
    const back = await staff.post(`/api/v1/conversations/${t.orgA.conversation.id}/handback`)
    expect(back.body).toMatchObject({ mode: 'bot', humanUntil: null, handoffReason: null })
    const actions = (
      await t.db.select().from(auditLogs).where(eq(auditLogs.entityId, t.orgA.conversation.id))
    ).map((a) => a.action)
    expect(actions).toEqual(
      expect.arrayContaining(['conversation.takeover', 'conversation.handback']),
    )
  })

  it('messages come oldest first, and marking read clears the unread count', async () => {
    const owner = await t.login(t.users.owner)
    const res = await owner.get(`/api/v1/conversations/${t.orgA.conversation.id}/messages`)
    expect(res.body.messages[0]).toMatchObject({ direction: 'in', body: 'Fees kitni hai?' })
    expect(res.body.messages[0]).not.toHaveProperty('mediaKey')
    await owner.post(`/api/v1/conversations/${t.orgA.conversation.id}/read`)
    const [conv] = await t.db
      .select()
      .from(conversations)
      .where(eq(conversations.id, t.orgA.conversation.id))
    expect(conv?.unreadCount).toBe(0)
  })

  it('filters: waiting for staff (human mode) and search', async () => {
    const owner = await t.login(t.users.owner)
    await owner.post(`/api/v1/conversations/${t.orgA.conversation.id}/takeover`)
    expect((await owner.get('/api/v1/conversations?mode=human')).body.conversations).toHaveLength(1)
    expect((await owner.get('/api/v1/conversations?mode=bot')).body.conversations).toHaveLength(0)
    expect((await owner.get('/api/v1/conversations?q=98111')).body.conversations).toHaveLength(1)
    expect((await owner.get('/api/v1/conversations?q=nobody')).body.conversations).toHaveLength(0)
  })

  it('contact panel: edits name, tags and notes', async () => {
    const staff = await t.login(t.users.staff)
    const res = await staff
      .patch(`/api/v1/contacts/${t.orgA.contact.id}`)
      .send({ name: 'Anil Kumar', tags: ['RS-CIT', 'shaam'], notes: 'Papa ke saath aayenge' })
    expect(res.body).toMatchObject({
      name: 'Anil Kumar',
      tags: ['RS-CIT', 'shaam'],
      notes: 'Papa ke saath aayenge',
    })
  })
})

describe('roles', () => {
  it('staff (agent) can chat but cannot change bot settings or teach the bot', async () => {
    const staff = await t.login(t.users.staff)
    expect((await staff.patch('/api/v1/bot').send({ personaName: 'X' })).status).toBe(403)
    expect(
      (await staff.post('/api/v1/knowledge/faqs').send({ question: 'Parking?', answer: 'Haan' }))
        .status,
    ).toBe(403)
    expect((await staff.get('/api/v1/bot')).status).toBe(200)
  })

  it('only the super admin reaches /admin', async () => {
    const owner = await t.login(t.users.owner)
    expect((await owner.get('/api/v1/admin/orgs')).status).toBe(403)
    const admin = await t.login(t.users.superAdmin)
    const res = await admin.get('/api/v1/admin/orgs')
    expect(res.status).toBe(200)
    expect(res.body.orgs.length).toBeGreaterThanOrEqual(2)
  })
})
