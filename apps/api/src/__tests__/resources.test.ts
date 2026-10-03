import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  auditLogs,
  knowledgeFaqs,
  knowledgeSources,
  messages,
  pushSubscriptions,
  unansweredQuestions,
  whatsappAccounts,
} from '@haazir/db'
import { decryptSecret } from '@haazir/shared/crypto'
import { GraphClient } from '@haazir/whatsapp'
import { createTestApp, ENCRYPTION_KEY } from './helpers'

let t: Awaited<ReturnType<typeof createTestApp>>
beforeAll(async () => {
  t = await createTestApp({
    // A Graph client whose "fetch" answers like Meta does for a good token.
    graph: (account) =>
      new GraphClient({
        baseUrl: 'https://graph.test',
        version: 'v26.0',
        accessToken: 'x',
        phoneNumberId: account.phoneNumberId,
        fetch: async () =>
          new Response(
            JSON.stringify({
              display_phone_number: '+91 98765 00000',
              verified_name: 'Naya Institute',
              quality_rating: 'GREEN',
              id: account.phoneNumberId,
            }),
          ),
      }),
  })
})
afterAll(() => t.close())

describe('Bot ko sikhayein (knowledge)', () => {
  it('adds pasted text and queues it for the bot to learn', async () => {
    const owner = await t.login(t.users.owner)
    const res = await owner.post('/api/v1/knowledge/sources').send({
      type: 'text',
      title: 'Niyam',
      text: 'Class mein mobile phone band rakhna hota hai. Late aane par attendance nahi lagti.',
    })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ type: 'text', title: 'Niyam', status: 'pending' })
    expect(t.rec.ingest).toContainEqual({ orgId: t.orgA.org.id, sourceId: res.body.id })
  })

  it('accepts a PDF brochure upload into storage', async () => {
    const owner = await t.login(t.users.owner)
    const res = await owner
      .post('/api/v1/knowledge/sources')
      .attach('file', Buffer.from('%PDF-1.4 tiny'), {
        filename: 'brochure.pdf',
        contentType: 'application/pdf',
      })
    expect(res.status).toBe(201)
    const [source] = await t.db
      .select()
      .from(knowledgeSources)
      .where(eq(knowledgeSources.id, res.body.id))
    expect(source?.fileKey).toBe(`orgs/${t.orgA.org.id}/knowledge/${res.body.id}.pdf`)
  })

  it('refuses non-PDF uploads and links to non-http places', async () => {
    const owner = await t.login(t.users.owner)
    expect(
      (
        await owner.post('/api/v1/knowledge/sources').attach('file', Buffer.from('x'), {
          filename: 'a.exe',
          contentType: 'application/octet-stream',
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await owner
          .post('/api/v1/knowledge/sources')
          .send({ type: 'url', url: 'file:///etc/passwd' })
      ).status,
    ).toBe(400)
  })

  it('FAQs: add, edit, delete, each re-teaching the bot', async () => {
    const owner = await t.login(t.users.owner)
    t.rec.ingest.length = 0
    const created = await owner
      .post('/api/v1/knowledge/faqs')
      .send({ question: 'Hostel hai?', answer: 'Nahi, paas mein PG milte hain.' })
    expect(created.status).toBe(201)
    await owner
      .patch(`/api/v1/knowledge/faqs/${created.body.id}`)
      .send({ answer: 'Nahi. Station ke paas PG milte hain.' })
    await owner.delete(`/api/v1/knowledge/faqs/${created.body.id}`)
    expect(t.rec.ingest).toHaveLength(3)
  })

  it('"Jawab likhein": an unanswered question becomes an FAQ and disappears from the list', async () => {
    const owner = await t.login(t.users.owner)
    const [q] = await t.db
      .insert(unansweredQuestions)
      .values({
        orgId: t.orgA.org.id,
        question: 'Scholarship milti hai?',
        normalized: 'scholarship milti hai',
        count: 4,
      })
      .returning()
    const list = await owner.get('/api/v1/knowledge/unanswered')
    expect(list.body.questions[0]).toMatchObject({ question: 'Scholarship milti hai?', count: 4 })

    const res = await owner
      .post(`/api/v1/knowledge/unanswered/${q!.id}/resolve`)
      .send({ answer: 'Abhi koi scholarship nahi hai.' })
    expect(res.status).toBe(201)
    const [faq] = await t.db.select().from(knowledgeFaqs).where(eq(knowledgeFaqs.id, res.body.id))
    expect(faq).toMatchObject({
      question: 'Scholarship milti hai?',
      answer: 'Abhi koi scholarship nahi hai.',
    })
    expect((await owner.get('/api/v1/knowledge/unanswered')).body.questions).toHaveLength(0)
  })

  it('the test box runs the real pipeline (here without an AI key: it says it would hand over)', async () => {
    const staff = await t.login(t.users.staff)
    const res = await staff.post('/api/v1/knowledge/test').send({ question: 'RSCIT ki fees?' })
    expect(res.body).toMatchObject({ kind: 'handoff', handoff: { reason: 'ai_unavailable' } })
    // What the person would have been told, as plain text for the dashboard.
    expect(res.body.reply).toEqual(expect.any(String))
    expect(res.body.buttons).toEqual([])
    // The playground chat never shows up in the inbox.
    const inbox = await staff.get('/api/v1/conversations')
    expect(
      inbox.body.conversations.every(
        (c: { contact: { waId: string } }) => !c.contact.waId.startsWith('playground'),
      ),
    ).toBe(true)
  })
})

describe('bot settings', () => {
  it('saves settings, keeps WhatsApp limits, and audit-logs the change', async () => {
    const owner = await t.login(t.users.owner)
    const ok = await owner
      .patch('/api/v1/bot')
      .send({ personaName: 'Shiksha Sahayak', enabled: false })
    expect(ok.body).toMatchObject({
      personaName: 'Shiksha Sahayak',
      enabled: false,
      aiConfigured: false,
    })
    const [log] = await t.db.select().from(auditLogs).where(eq(auditLogs.action, 'bot.disabled'))
    expect(log?.diff).toMatchObject({ enabled: { from: true, to: false } })

    const tooLong = await owner.patch('/api/v1/bot').send({
      mainMenu: [{ id: 'menu_courses', title: { hinglish: 'Saare courses dekhiye yahan' } }],
    })
    expect(tooLong.status).toBe(400)
    const noOptOut = await owner.patch('/api/v1/bot').send({ optoutKeywords: [] })
    expect(noOptOut.status).toBe(400)
    await owner.patch('/api/v1/bot').send({ enabled: true })
  })
})

describe('super admin: connect a WhatsApp number by hand', () => {
  it('stores the token encrypted, and "test connection" fills in the number details', async () => {
    const admin = await t.login(t.users.superAdmin)
    const res = await admin.post(`/api/v1/admin/orgs/${t.orgB.org.id}/whatsapp`).send({
      wabaId: '5550001',
      phoneNumberId: '5550002',
      accessToken: 'EAAG-a-very-long-system-user-token',
    })
    expect(res.status).toBe(201)
    expect(res.body).not.toHaveProperty('accessTokenEnc')
    const [row] = await t.db
      .select()
      .from(whatsappAccounts)
      .where(eq(whatsappAccounts.phoneNumberId, '5550002'))
    expect(row!.accessTokenEnc).not.toContain('EAAG')
    expect(decryptSecret(row!.accessTokenEnc, ENCRYPTION_KEY)).toBe(
      'EAAG-a-very-long-system-user-token',
    )

    const test = await admin.post(`/api/v1/admin/orgs/${t.orgB.org.id}/whatsapp/${row!.id}/test`)
    expect(test.body).toMatchObject({
      ok: true,
      displayPhone: '+91 98765 00000',
      verifiedName: 'Naya Institute',
      qualityRating: 'GREEN',
    })
  })

  it("won't connect a number that belongs to another org", async () => {
    const admin = await t.login(t.users.superAdmin)
    const res = await admin.post(`/api/v1/admin/orgs/${t.orgA.org.id}/whatsapp`).send({
      wabaId: '5550001',
      phoneNumberId: '5550002',
      accessToken: 'EAAG-a-very-long-system-user-token',
    })
    expect(res.status).toBe(400)
  })
})

describe('push subscriptions', () => {
  it('subscribes and unsubscribes a device', async () => {
    const staff = await t.login(t.users.staff)
    expect((await staff.get('/api/v1/push/public-key')).body.publicKey).toBe('BTestPublicKey')
    const sub = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
      keys: { p256dh: 'BPublicKeyForTheDevice', auth: 'authsecret12' },
      deviceLabel: 'Pooja ka phone',
    }
    expect((await staff.post('/api/v1/push/subscribe').send(sub)).status).toBe(201)
    expect(await t.db.$count(pushSubscriptions)).toBe(1)
    await staff.delete('/api/v1/push/subscribe').send({ endpoint: sub.endpoint })
    expect(await t.db.$count(pushSubscriptions)).toBe(0)
  })
})

describe('notification preferences', () => {
  it('each person switches handoff push on or off for themselves only', async () => {
    const staff = await t.login(t.users.staff)
    const owner = await t.login(t.users.owner)
    expect((await staff.get('/api/v1/members/me/notifications')).body).toEqual({
      handoffPush: true,
    })
    await staff.patch('/api/v1/members/me/notifications').send({ handoffPush: false })
    expect((await staff.get('/api/v1/members/me/notifications')).body).toEqual({
      handoffPush: false,
    })
    expect((await owner.get('/api/v1/members/me/notifications')).body).toEqual({
      handoffPush: true,
    })
    await staff.patch('/api/v1/members/me/notifications').send({ handoffPush: true })
  })
})

describe('media', () => {
  it('streams a chat photo to members of the org', async () => {
    const owner = await t.login(t.users.owner)
    const key = `orgs/${t.orgA.org.id}/media/${t.orgA.message.id}.jpg`
    await t.deps.storage.put(key, Buffer.from('jpeg!'), 'image/jpeg')
    await t.db
      .update(messages)
      .set({ mediaKey: key, mediaMime: 'image/jpeg' })
      .where(eq(messages.id, t.orgA.message.id))
    const res = await owner.get(`/api/v1/media/${t.orgA.message.id}`)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('image/jpeg')
    expect(res.body.toString()).toBe('jpeg!')
  })
})
