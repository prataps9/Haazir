import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { whatsappAccounts } from '@haazir/db'
import { seed } from '@haazir/db/seed'
import { createTestDb } from '@haazir/db/testing'
import { graphClientFor, type AiReplyJob, type MediaJob, type OutboundJob } from '@haazir/messaging'
import { encryptSecret } from '@haazir/shared/crypto'
import { LocalStorage } from '@haazir/storage'
import type { Models } from '@haazir/ai-core'
import { MockEmbeddingModelV4, MockLanguageModelV4 } from 'ai/test'
import type { Deps } from '../deps'

export const GRAPH = 'https://graph.test'
export const PHONE_NUMBER_ID = '106540352242922'
export const TOKEN = 'EAAG-test-token'
const KEY = Buffer.alloc(32, 9).toString('base64')

/** Meta's side of the conversation, as MSW handlers that record what we sent. */
export function mockGraph() {
  const sent: { to: string; body: Record<string, unknown>; auth: string | null }[] = []
  const reads: Record<string, unknown>[] = []
  let next = 1
  let failWith: { status: number; error: Record<string, unknown> } | null = null

  const server = setupServer(
    http.post(`${GRAPH}/v26.0/${PHONE_NUMBER_ID}/messages`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>
      if (body.status === 'read') {
        reads.push(body)
        return HttpResponse.json({ success: true })
      }
      if (failWith) return HttpResponse.json({ error: failWith.error }, { status: failWith.status })
      sent.push({ to: body.to as string, body, auth: request.headers.get('authorization') })
      return HttpResponse.json({
        messaging_product: 'whatsapp',
        messages: [{ id: `wamid.OUT${next++}` }],
      })
    }),
    http.get(`${GRAPH}/v26.0/998877`, () =>
      HttpResponse.json({
        url: 'https://lookaside.test/998877',
        mime_type: 'image/jpeg',
        file_size: 11,
        id: '998877',
      }),
    ),
    http.get(`${GRAPH}/v26.0/445566`, () =>
      HttpResponse.json({
        url: 'https://lookaside.test/445566',
        mime_type: 'audio/ogg',
        file_size: 4,
        id: '445566',
      }),
    ),
    http.get(
      'https://lookaside.test/445566',
      () => new HttpResponse('OggS', { headers: { 'content-type': 'audio/ogg' } }),
    ),
    http.get('https://lookaside.test/998877', ({ request }) =>
      request.headers.get('authorization') === `Bearer ${TOKEN}`
        ? new HttpResponse('jpeg-bytes!', { headers: { 'content-type': 'image/jpeg' } })
        : new HttpResponse(null, { status: 401 }),
    ),
  )
  return {
    server,
    sent,
    reads,
    failNextSends(status: number, error: Record<string, unknown>) {
      failWith = { status, error }
    },
    reset() {
      sent.length = 0
      reads.length = 0
      failWith = null
      next = 1
    },
  }
}

/** What the stand-in brain always says: no numbers, so no guardrail trips. */
export const MOCK_REPLY = 'Ji, main aapki madad karta hoon. Aap kaunsa course dekh rahe hain?'

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
}
const textModel = (text: string) =>
  new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: 'text', text }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage,
      warnings: [],
    }),
  })

/** A brain that routes everything to "course_info" and answers with MOCK_REPLY. */
export function mockModels(): Models {
  return {
    fast: textModel(
      JSON.stringify({
        language: 'hinglish',
        script: 'latin',
        intent: 'other',
        entities: {},
        confidence: 0.9,
      }),
    ),
    smart: textModel(MOCK_REPLY),
    embedding: new MockEmbeddingModelV4({
      doEmbed: async ({ values }) => ({
        embeddings: values.map(() => new Array(1536).fill(0.01)),
        warnings: [],
      }),
    }),
    ids: { fast: 'mock-fast', smart: 'mock-smart', embedding: 'mock-embed' },
  }
}

export interface Recorded<T> {
  name: string
  data: T
  opts?: { jobId?: string }
}

/** A queue that records jobs, de-duplicating by jobId like BullMQ does. */
function recorder<T>() {
  const jobs: Recorded<T>[] = []
  const seen = new Set<string>()
  return {
    jobs,
    /** Makes the next add() throw, like Redis dropping out mid-job. */
    failNext: false,
    async add(name: string, data: T, opts?: { jobId?: string }) {
      if (this.failNext) {
        this.failNext = false
        throw new Error('queue unavailable')
      }
      // BullMQ rejects custom ids containing ":".
      if (opts?.jobId?.includes(':')) throw new Error('Custom Id cannot contain :')
      if (opts?.jobId && seen.has(opts.jobId)) return
      if (opts?.jobId) seen.add(opts.jobId)
      jobs.push({ name, data, opts })
    },
  }
}

export async function createHarness() {
  const { db, close } = await createTestDb()
  const { org } = await seed(db)
  const [account] = await db
    .insert(whatsappAccounts)
    .values({
      orgId: org.id,
      wabaId: '102290129340398',
      phoneNumberId: PHONE_NUMBER_ID,
      accessTokenEnc: encryptSecret(TOKEN, KEY),
    })
    .returning()

  const emitted: { orgId: string; event: string; data: unknown }[] = []
  const kv = new Map<string, string>()
  const chains = new Map<string, Promise<unknown>>()
  const queues = {
    aiReply: recorder<AiReplyJob>(),
    media: recorder<MediaJob>(),
    outbound: recorder<OutboundJob>(),
  }
  const storageDir = await mkdtemp(join(tmpdir(), 'haazir-worker-'))
  const silent = () => {}

  let now = new Date('2026-09-26T07:21:00Z') // a minute after the fixtures' messages

  const deps: Deps = {
    db,
    kv: {
      exists: async (key) => kv.has(key),
      set: async (key, value) => void kv.set(key, value),
    },
    locks: {
      // In-process mutex: chains work per key, like the Redis lock does across processes.
      withLock: (key, fn) => {
        const run = (chains.get(key) ?? Promise.resolve()).then(fn, fn)
        chains.set(
          key,
          run.catch(() => {}),
        )
        return run
      },
    },
    queues,
    storage: new LocalStorage(storageDir),
    graph: (acc) =>
      graphClientFor(acc, {
        META_GRAPH_BASE_URL: GRAPH,
        META_GRAPH_API_VERSION: 'v26.0',
        ENCRYPTION_KEY: KEY,
      }),
    models: mockModels(),
    stt: null,
    events: {
      emit: (orgId: string, event: string, data: unknown) =>
        void emitted.push({ orgId, event, data }),
    },
    push: null,
    log: { debug: silent, info: silent, warn: silent, error: silent },
    now: () => now,
  }

  return {
    db,
    deps,
    emitted,
    kv,
    queues,
    org,
    account: account!,
    storageDir,
    setNow(d: Date) {
      now = d
    },
    close,
  }
}

// ---- Webhook bodies (Graph API v26.0 shapes) ----

const envelope = (value: Record<string, unknown>) => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: '102290129340398',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '919876500000', phone_number_id: PHONE_NUMBER_ID },
            ...value,
          },
        },
      ],
    },
  ],
})

export function inboundText(opts: {
  id: string
  body?: string
  from?: string
  bsuid?: string
  name?: string
  ts?: number
  phoneNumberId?: string
}) {
  const from = opts.from ?? '919812345678'
  const bsuid = opts.bsuid ?? 'IN.13491208655302741918'
  const body = envelope({
    contacts: [{ profile: { name: opts.name ?? 'Anil Kumar' }, wa_id: from, user_id: bsuid }],
    messages: [
      {
        from,
        user_id: bsuid,
        id: opts.id,
        timestamp: String(opts.ts ?? 1790407200),
        type: 'text',
        text: { body: opts.body ?? 'RS-CIT ki fees kitni hai?' },
      },
    ],
  })
  if (opts.phoneNumberId) {
    ;(
      body.entry[0]!.changes[0]!.value as { metadata: { phone_number_id: string } }
    ).metadata.phone_number_id = opts.phoneNumberId
  }
  return body
}

export function inboundImage(id: string) {
  return envelope({
    contacts: [
      {
        profile: { name: 'Anil Kumar' },
        wa_id: '919812345678',
        user_id: 'IN.13491208655302741918',
      },
    ],
    messages: [
      {
        from: '919812345678',
        user_id: 'IN.13491208655302741918',
        id,
        timestamp: '1790407230',
        type: 'image',
        image: { id: '998877', mime_type: 'image/jpeg', caption: 'Fees ki receipt' },
      },
    ],
  })
}

export function inboundVoiceNote(id: string) {
  return envelope({
    contacts: [
      {
        profile: { name: 'Anil Kumar' },
        wa_id: '919812345678',
        user_id: 'IN.13491208655302741918',
      },
    ],
    messages: [
      {
        from: '919812345678',
        user_id: 'IN.13491208655302741918',
        id,
        timestamp: '1790407235',
        type: 'audio',
        audio: { id: '445566', mime_type: 'audio/ogg; codecs=opus', voice: true },
      },
    ],
  })
}

export function inboundReaction(id: string) {
  return envelope({
    contacts: [
      {
        profile: { name: 'Anil Kumar' },
        wa_id: '919812345678',
        user_id: 'IN.13491208655302741918',
      },
    ],
    messages: [
      {
        from: '919812345678',
        user_id: 'IN.13491208655302741918',
        id,
        timestamp: '1790407240',
        type: 'reaction',
        reaction: { message_id: 'wamid.OUT1', emoji: '🙏' },
      },
    ],
  })
}

export function statusUpdate(
  waMessageId: string,
  status: 'sent' | 'delivered' | 'read' | 'failed',
  errors?: Record<string, unknown>[],
) {
  return envelope({
    statuses: [
      {
        id: waMessageId,
        status,
        timestamp: '1790407300',
        recipient_id: '919812345678',
        pricing: { billable: false, pricing_model: 'PMP', category: 'service' },
        ...(errors ? { errors } : {}),
      },
    ],
  })
}
