import { eq } from 'drizzle-orm'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  aiTraces,
  contacts,
  conversations,
  memberships,
  messages,
  organizations,
  pushSubscriptions,
  whatsappAccounts,
} from '@haazir/db'
import { queueOutbound } from '@haazir/messaging'
import { AppError } from '@haazir/shared'
import { processAiReply } from '../processors/aiReply'
import { processInbound, StatusNotYetMatched } from '../processors/inbound'
import { processMedia } from '../processors/media'
import { processOutbound } from '../processors/outbound'
import {
  createHarness,
  inboundImage,
  inboundReaction,
  inboundText,
  inboundVoiceNote,
  mockGraph,
  MOCK_REPLY,
  statusUpdate,
  TOKEN,
} from './harness'

const graph = mockGraph()
beforeAll(() => graph.server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => graph.server.resetHandlers())
afterAll(() => graph.server.close())

let h: Awaited<ReturnType<typeof createHarness>>
beforeEach(async () => {
  graph.reset()
  h = await createHarness()
})
afterEach(async () => {
  await h.close()
})

/** Drains the recorded queues in order, the way the worker would. */
async function runQueues() {
  for (const job of h.queues.aiReply.jobs.splice(0)) await processAiReply(h.deps, job.data)
  for (const job of h.queues.outbound.jobs.splice(0)) await processOutbound(h.deps, job.data)
}

describe('inbound → brain → reply', () => {
  it('stores the message, opens the 24h window, and the brain replies', async () => {
    const result = await processInbound(h.deps, { payload: inboundText({ id: 'wamid.IN1' }) })
    expect(result).toEqual({ stored: 1, duplicates: 0, statuses: 0, dropped: 0 })

    const [contact] = await h.db.select().from(contacts)
    expect(contact).toMatchObject({
      orgId: h.org.id,
      waId: '919812345678',
      bsuid: 'IN.13491208655302741918',
      profileName: 'Anil Kumar',
    })
    const [conversation] = await h.db.select().from(conversations)
    expect(conversation?.unreadCount).toBe(1)
    expect(conversation?.lastMessagePreview).toBe('RS-CIT ki fees kitni hai?')
    expect(conversation?.serviceWindowExpiresAt).toEqual(new Date((1790407200 + 86400) * 1000))

    expect(h.queues.aiReply.jobs).toHaveLength(1)
    await runQueues()

    // Read receipt + typing, then exactly one reply, sent with the decrypted token.
    expect(graph.reads).toEqual([
      expect.objectContaining({ message_id: 'wamid.IN1', typing_indicator: { type: 'text' } }),
    ])
    expect(graph.sent).toHaveLength(1)
    expect(graph.sent[0]).toMatchObject({
      to: '919812345678',
      auth: `Bearer ${TOKEN}`,
      body: { type: 'text', text: { body: MOCK_REPLY } },
    })

    const out = await h.db.select().from(messages).where(eq(messages.direction, 'out'))
    expect(out).toEqual([
      expect.objectContaining({
        body: MOCK_REPLY,
        sentBy: 'bot',
        status: 'queued',
        waMessageId: 'wamid.OUT1',
      }),
    ])
  })

  it('updates statuses: sent → delivered → read, and never backwards', async () => {
    await processInbound(h.deps, { payload: inboundText({ id: 'wamid.IN1' }) })
    await runQueues()

    const statusOf = async () =>
      (await h.db.select().from(messages).where(eq(messages.waMessageId, 'wamid.OUT1')))[0]

    await processInbound(h.deps, { payload: statusUpdate('wamid.OUT1', 'sent') })
    expect((await statusOf())?.status).toBe('sent')
    await processInbound(h.deps, { payload: statusUpdate('wamid.OUT1', 'read') })
    await processInbound(h.deps, { payload: statusUpdate('wamid.OUT1', 'delivered') }) // late
    const final = await statusOf()
    expect(final?.status).toBe('read')
    expect(final?.pricingCategory).toBe('service')
  })

  it('records why a message failed', async () => {
    await processInbound(h.deps, { payload: inboundText({ id: 'wamid.IN1' }) })
    await runQueues()
    await processInbound(h.deps, {
      payload: statusUpdate('wamid.OUT1', 'failed', [
        {
          code: 131026,
          title: 'Message undeliverable',
          error_data: { details: 'Receiver is incapable' },
        },
      ]),
    })
    const [row] = await h.db.select().from(messages).where(eq(messages.waMessageId, 'wamid.OUT1'))
    expect(row).toMatchObject({
      status: 'failed',
      errorCode: '131026',
      errorTitle: 'Receiver is incapable',
    })
  })
})

describe('duplicates', () => {
  it('a webhook delivered twice stores one message and sends one reply', async () => {
    const payload = inboundText({ id: 'wamid.IN1' })
    await processInbound(h.deps, { payload })
    const second = await processInbound(h.deps, { payload })
    expect(second.duplicates).toBe(1)
    await runQueues()

    expect(await h.db.$count(messages, eq(messages.direction, 'in'))).toBe(1)
    expect(graph.sent).toHaveLength(1)
  })

  it('still holds if Redis forgot (the database unique key is the real guard)', async () => {
    const payload = inboundText({ id: 'wamid.IN1' })
    await processInbound(h.deps, { payload })
    h.kv.clear()
    const second = await processInbound(h.deps, { payload })
    expect(second).toMatchObject({ stored: 0, duplicates: 1 })
    expect(await h.db.$count(messages)).toBe(1)
    await runQueues()
    expect(graph.sent).toHaveLength(1)
  })

  it('gets the reply out even if queueing it failed after the message was stored', async () => {
    const payload = inboundText({ id: 'wamid.IN1' })
    h.queues.aiReply.failNext = true
    await expect(processInbound(h.deps, { payload })).rejects.toThrow('queue unavailable')
    expect(await h.db.$count(messages)).toBe(1) // stored, but nothing queued yet

    await processInbound(h.deps, { payload }) // BullMQ's retry
    await runQueues()
    expect(graph.sent).toHaveLength(1)
  })

  it('a re-queued reply job does not answer twice', async () => {
    await processInbound(h.deps, { payload: inboundText({ id: 'wamid.IN1' }) })
    const [job] = h.queues.aiReply.jobs
    await processAiReply(h.deps, job!.data)
    await processAiReply(h.deps, job!.data)
    for (const out of h.queues.outbound.jobs.splice(0)) await processOutbound(h.deps, out.data)
    expect(graph.sent).toHaveLength(1)
  })

  it('two different messages from one person make one contact and one conversation', async () => {
    await processInbound(h.deps, { payload: inboundText({ id: 'wamid.IN1', ts: 1790407200 }) })
    await processInbound(h.deps, {
      payload: inboundText({ id: 'wamid.IN2', body: 'Aur timing?', ts: 1790407260 }),
    })
    expect(await h.db.$count(contacts)).toBe(1)
    const [conversation] = await h.db.select().from(conversations)
    expect(conversation?.unreadCount).toBe(2)
    expect(conversation?.lastMessagePreview).toBe('Aur timing?')
  })

  it('a late delivery of an older message does not overwrite the newer preview', async () => {
    await processInbound(h.deps, {
      payload: inboundText({ id: 'wamid.IN2', body: 'Newer', ts: 1790407260 }),
    })
    await processInbound(h.deps, {
      payload: inboundText({ id: 'wamid.IN1', body: 'Older', ts: 1790407200 }),
    })
    const [conversation] = await h.db.select().from(conversations)
    expect(conversation?.lastMessagePreview).toBe('Newer')
    expect(conversation?.serviceWindowExpiresAt).toEqual(new Date((1790407260 + 86400) * 1000))
  })
})

describe('contacts and usernames', () => {
  it('keeps one contact when a person switches from phone number to username', async () => {
    await processInbound(h.deps, { payload: inboundText({ id: 'wamid.IN1' }) })
    // Same person (same BSUID), now with a username: no phone number in the webhook.
    await processInbound(h.deps, {
      payload: inboundText({ id: 'wamid.IN2', from: 'IN.13491208655302741918', name: 'anil.k' }),
    })
    const all = await h.db.select().from(contacts)
    expect(all).toHaveLength(1)
    expect(all[0]?.waId).toBe('919812345678') // the phone number is kept for sending
    expect(all[0]?.profileName).toBe('anil.k')
  })
})

describe('what gets a reply, and what does not', () => {
  it('does not reply to a reaction', async () => {
    await processInbound(h.deps, { payload: inboundReaction('wamid.R1') })
    expect(h.queues.aiReply.jobs).toHaveLength(0)
  })

  it('does not reply when staff have taken over the chat', async () => {
    await processInbound(h.deps, { payload: inboundText({ id: 'wamid.IN1' }) })
    await h.db.update(conversations).set({ mode: 'human' })
    await runQueues()
    expect(graph.sent).toHaveLength(0)
  })

  it('does not reply to someone who opted out', async () => {
    await processInbound(h.deps, { payload: inboundText({ id: 'wamid.IN1' }) })
    await h.db.update(contacts).set({ optInStatus: 'opted_out' })
    await runQueues()
    expect(graph.sent).toHaveLength(0)
    expect(await h.db.$count(messages, eq(messages.direction, 'out'))).toBe(0)
  })

  it('drops messages for a number no org has connected', async () => {
    const result = await processInbound(h.deps, {
      payload: inboundText({ id: 'wamid.X', phoneNumberId: '999' }),
    })
    expect(result.dropped).toBe(1)
    expect(await h.db.$count(messages)).toBe(0)
  })
})

describe('outbound gate', () => {
  it('refuses free-form text once the 24h window has closed, writing nothing', async () => {
    await processInbound(h.deps, { payload: inboundText({ id: 'wamid.IN1' }) })
    const [conversation] = await h.db.select().from(conversations)
    const error = await queueOutbound(
      { db: h.db, outboundQueue: h.queues.outbound },
      {
        orgId: h.org.id,
        conversationId: conversation!.id,
        content: { kind: 'text', body: 'Hello again' },
        sentBy: 'user',
        now: new Date((1790407200 + 86400 + 1) * 1000),
      },
    ).catch((e) => e)
    expect(error).toBeInstanceOf(AppError)
    expect(error.code).toBe('WINDOW_CLOSED')
    expect(await h.db.$count(messages, eq(messages.direction, 'out'))).toBe(0)
  })

  it("won't touch another org's conversation", async () => {
    await processInbound(h.deps, { payload: inboundText({ id: 'wamid.IN1' }) })
    const [conversation] = await h.db.select().from(conversations)
    const error = await queueOutbound(
      { db: h.db, outboundQueue: h.queues.outbound },
      {
        orgId: '00000000-0000-0000-0000-000000000000',
        conversationId: conversation!.id,
        content: { kind: 'text', body: 'x' },
        sentBy: 'user',
      },
    ).catch((e) => e)
    expect(error.code).toBe('NOT_FOUND')
  })
})

describe('outbound failures', () => {
  async function queueOne() {
    await processInbound(h.deps, { payload: inboundText({ id: 'wamid.IN1' }) })
    for (const job of h.queues.aiReply.jobs.splice(0)) await processAiReply(h.deps, job.data)
    return h.queues.outbound.jobs.splice(0)[0]!.data
  }

  it('records a policy error as failed without retrying', async () => {
    const job = await queueOne()
    graph.failNextSends(400, { code: 131047, message: 'Re-engagement message' })
    expect(await processOutbound(h.deps, job)).toEqual({ sent: false })
    const [row] = await h.db.select().from(messages).where(eq(messages.direction, 'out'))
    expect(row).toMatchObject({ status: 'failed', errorCode: '131047' })
  })

  it('throws on a Meta outage so BullMQ retries, and fails it on the last attempt', async () => {
    const job = await queueOne()
    graph.failNextSends(500, { code: 2, message: 'Service temporarily unavailable' })
    await expect(processOutbound(h.deps, job)).rejects.toThrow(/temporarily unavailable/)
    let [row] = await h.db.select().from(messages).where(eq(messages.direction, 'out'))
    expect(row?.status).toBe('queued')

    await processOutbound(h.deps, job, true)
    ;[row] = await h.db.select().from(messages).where(eq(messages.direction, 'out'))
    expect(row?.status).toBe('failed')
  })

  it('marks the number as broken when the token has expired', async () => {
    const job = await queueOne()
    graph.failNextSends(401, { code: 190, message: 'Error validating access token' })
    await processOutbound(h.deps, job)
    const [account] = await h.db.select().from(whatsappAccounts)
    expect(account).toMatchObject({ status: 'error', lastError: 'Error validating access token' })
  })

  it('never sends the same message twice', async () => {
    const job = await queueOne()
    await processOutbound(h.deps, job)
    await processOutbound(h.deps, job) // a retried job after a crash
    expect(graph.sent).toHaveLength(1)
  })
})

describe("the brain's decisions, carried out", () => {
  it('writes an ai_trace for every reply', async () => {
    await processInbound(h.deps, { payload: inboundText({ id: 'wamid.IN1' }) })
    await runQueues()
    const [trace] = await h.db.select().from(aiTraces)
    expect(trace).toMatchObject({
      orgId: h.org.id,
      intent: 'other',
      model: 'mock-smart',
      handedOff: false,
      promptVersion: 'answer-v1',
    })
  })

  it('STOP: one confirmation, the contact opted out, and silence after that', async () => {
    await processInbound(h.deps, { payload: inboundText({ id: 'wamid.IN1', body: 'STOP' }) })
    await runQueues()
    expect(graph.sent).toHaveLength(1)
    expect(graph.sent[0]!.body).toMatchObject({
      text: { body: "Okay, we won't message you again." },
    })
    const [contact] = await h.db.select().from(contacts)
    expect(contact?.optInStatus).toBe('opted_out')

    await processInbound(h.deps, {
      payload: inboundText({ id: 'wamid.IN2', body: 'aur fees?', ts: 1790407260 }),
    })
    await runQueues()
    expect(graph.sent).toHaveLength(1)
  })

  it('handoff: tells the person, puts the chat in human mode for 2 hours, and counts the question', async () => {
    h.deps.models = null // no AI configured: everything goes to staff
    await processInbound(h.deps, {
      payload: inboundText({ id: 'wamid.IN1', body: 'Hostel hai kya?' }),
    })
    await runQueues()
    expect(graph.sent[0]!.body).toMatchObject({
      text: { body: expect.stringContaining('Main aapki baat team se karwa raha hoon') },
    })
    const [conversation] = await h.db.select().from(conversations)
    expect(conversation).toMatchObject({ mode: 'human', handoffReason: 'ai_unavailable' })
    expect(conversation!.humanUntil!.getTime() - h.deps.now().getTime()).toBe(2 * 60 * 60 * 1000)
    const [trace] = await h.db.select().from(aiTraces)
    expect(trace).toMatchObject({ handedOff: true, handoffReason: 'ai_unavailable' })

    // While staff have it, the bot neither replies nor shows read ticks.
    graph.reset()
    await processInbound(h.deps, {
      payload: inboundText({ id: 'wamid.IN2', body: 'Hello?', ts: 1790407260 }),
    })
    await runQueues()
    expect(graph.sent).toHaveLength(0)
    expect(graph.reads).toHaveLength(0)
  })
})

describe('voice notes', () => {
  it('are transcribed first, then answered like typed text', async () => {
    const heard: string[] = []
    h.deps.stt = {
      id: 'fake',
      transcribe: async (audio, mime) => {
        heard.push(`${new TextDecoder().decode(audio)} ${mime}`)
        return { text: 'RS-CIT ki fees kitni hai' }
      },
    }
    await processInbound(h.deps, { payload: inboundVoiceNote('wamid.V1') })
    expect(h.queues.aiReply.jobs).toHaveLength(0) // waits for the transcript

    await processMedia(h.deps, h.queues.media.jobs[0]!.data)
    expect(heard).toEqual(['OggS audio/ogg'])
    const [voice] = await h.db.select().from(messages).where(eq(messages.waMessageId, 'wamid.V1'))
    expect(voice?.transcript).toBe('RS-CIT ki fees kitni hai')

    await runQueues()
    expect(graph.sent).toHaveLength(1)
    expect(graph.sent[0]!.body).toMatchObject({ text: { body: MOCK_REPLY } })
  })

  it('without speech-to-text, go to staff with an acknowledgement', async () => {
    await processInbound(h.deps, { payload: inboundVoiceNote('wamid.V1') })
    await processMedia(h.deps, h.queues.media.jobs[0]!.data)
    await runQueues()
    expect(graph.sent[0]!.body).toMatchObject({
      text: { body: 'Voice note mil gaya. Team sun kar reply karegi.' },
    })
    const [conversation] = await h.db.select().from(conversations)
    expect(conversation?.handoffReason).toBe('voice_unclear')
  })
})

describe('live updates and push', () => {
  it("announces new messages, delivery statuses and the bot's reply to the org's dashboards", async () => {
    await processInbound(h.deps, { payload: inboundText({ id: 'wamid.IN1' }) })
    await runQueues()
    await processInbound(h.deps, { payload: statusUpdate('wamid.OUT1', 'delivered') })
    const events = h.emitted.map((e) => e.event)
    expect(events.filter((e) => e === 'message:new')).toHaveLength(2) // inbound + reply
    expect(events).toContain('message:updated')
    expect(events).toContain('conversation:updated')
    expect(h.emitted.every((e) => e.orgId === h.org.id)).toBe(true)
    const delivered = h.emitted.filter((e) => e.event === 'message:updated').at(-1)!.data as {
      status: string
    }
    expect(delivered.status).toBe('delivered')
  })

  it('a handoff raises a banner event and pushes to staff devices, forgetting dead ones', async () => {
    const pushed: { endpoint: string; title: string; url: string }[] = []
    h.deps.push = {
      send: async (sub, payload) => {
        pushed.push({ endpoint: sub.endpoint, title: payload.title, url: payload.url })
        return { gone: sub.endpoint.includes('dead') }
      },
    }
    const [member] = await h.db
      .select()
      .from(memberships)
      .where(eq(memberships.orgId, h.org.id))
      .limit(1)
    await h.db.insert(pushSubscriptions).values([
      {
        userId: member!.userId,
        endpoint: 'https://push.test/alive',
        keys: { p256dh: 'p', auth: 'a' },
      },
      {
        userId: member!.userId,
        endpoint: 'https://push.test/dead',
        keys: { p256dh: 'p', auth: 'a' },
      },
    ])
    h.deps.models = null // → handoff
    await processInbound(h.deps, { payload: inboundText({ id: 'wamid.IN1' }) })
    await runQueues()

    const handoff = h.emitted.find((e) => e.event === 'handoff')
    expect(handoff?.data).toMatchObject({ reason: 'ai_unavailable', contactName: 'Anil Kumar' })
    const [conversation] = await h.db.select().from(conversations)
    expect(pushed.map((p) => p.endpoint).sort()).toEqual([
      'https://push.test/alive',
      'https://push.test/dead',
    ])
    expect(pushed[0]).toMatchObject({
      title: 'Handoff: Anil Kumar',
      url: `/chat/${conversation!.id}`,
    })
    expect((await h.db.select().from(pushSubscriptions)).map((s) => s.endpoint)).toEqual([
      'https://push.test/alive',
    ])
  })

  it('respects a member who turned handoff pushes off', async () => {
    const pushed: string[] = []
    h.deps.push = { send: async (sub) => (pushed.push(sub.endpoint), { gone: false }) }
    const members = await h.db.select().from(memberships).where(eq(memberships.orgId, h.org.id))
    for (const m of members) {
      await h.db.insert(pushSubscriptions).values({
        userId: m.userId,
        endpoint: `https://push.test/${m.userId}`,
        keys: { p256dh: 'p', auth: 'a' },
      })
    }
    await h.db
      .update(memberships)
      .set({ notifyPrefs: { handoff: { push: false, email: false } } })
      .where(eq(memberships.id, members[0]!.id))
    h.deps.models = null
    await processInbound(h.deps, { payload: inboundText({ id: 'wamid.IN1' }) })
    await runQueues()
    expect(pushed).toHaveLength(members.length - 1)
  })
})

describe('tenant isolation', () => {
  it("a status from another org's number can't update our message", async () => {
    await processInbound(h.deps, { payload: inboundText({ id: 'wamid.IN1' }) })
    await runQueues()
    // A second org with its own number receives a status carrying our wamid.
    const [other] = await h.db
      .insert(organizations)
      .values({ name: 'Other Institute', slug: 'other' })
      .returning()
    await h.db.insert(whatsappAccounts).values({
      orgId: other!.id,
      wabaId: 'w2',
      phoneNumberId: '555',
      accessTokenEnc: 'v1.x.y.z',
    })
    const payload = statusUpdate('wamid.OUT1', 'failed')
    ;(
      payload.entry[0]!.changes[0]!.value as { metadata: { phone_number_id: string } }
    ).metadata.phone_number_id = '555'
    await processInbound(h.deps, { payload }, 3)
    const [row] = await h.db.select().from(messages).where(eq(messages.waMessageId, 'wamid.OUT1'))
    expect(row?.status).toBe('queued')
  })
})

describe('statuses that arrive before we know the message', () => {
  it('asks to be retried a few times, then gives up quietly', async () => {
    const payload = statusUpdate('wamid.UNKNOWN', 'delivered')
    await expect(processInbound(h.deps, { payload }, 0)).rejects.toBeInstanceOf(StatusNotYetMatched)
    await expect(processInbound(h.deps, { payload }, 3)).resolves.toMatchObject({ statuses: 0 })
  })
})

describe('media', () => {
  it('copies an inbound photo into storage and records where', async () => {
    await processInbound(h.deps, { payload: inboundImage('wamid.IMG1') })
    expect(h.queues.media.jobs).toHaveLength(1)
    const result = await processMedia(h.deps, h.queues.media.jobs[0]!.data)
    expect(result).toMatchObject({ stored: true, size: 11 })

    const [row] = await h.db.select().from(messages).where(eq(messages.waMessageId, 'wamid.IMG1'))
    expect(row?.mediaKey).toBe(`orgs/${h.org.id}/media/${row?.id}.jpg`)
    expect(row?.mediaMime).toBe('image/jpeg')
    expect(row?.body).toBe('Fees ki receipt')
    expect(await readFile(join(h.storageDir, row!.mediaKey!), 'utf8')).toBe('jpeg-bytes!')

    // A retried job doesn't download again.
    expect(await processMedia(h.deps, h.queues.media.jobs[0]!.data)).toEqual({ stored: false })
  })
})
