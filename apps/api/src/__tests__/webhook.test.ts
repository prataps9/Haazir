import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { InboundJob } from '@haazir/messaging'
import { signBody } from '@haazir/whatsapp'
import { createApp } from '../app'
import { createTestApp } from './helpers'

const SECRET = 'test-app-secret'

let base: Awaited<ReturnType<typeof createTestApp>>
beforeAll(async () => {
  base = await createTestApp()
})
afterAll(() => base.close())

function setup(opts: { appSecret?: string; verifyToken?: string; failQueue?: boolean } = {}) {
  const queued: InboundJob[] = []
  const app = createApp({
    ...base.deps,
    corsOrigins: [],
    whatsapp: {
      appSecret: 'appSecret' in opts ? opts.appSecret : SECRET,
      verifyToken: 'verifyToken' in opts ? opts.verifyToken : 'verify-me',
      inboundQueue: {
        add: async (_name, data) => {
          if (opts.failQueue) throw new Error('redis down')
          queued.push(data)
        },
      },
    },
  })
  return { app, queued }
}

// Deliberately not JSON.stringify output: odd spacing proves we sign raw bytes.
const body = '{"object":"whatsapp_business_account",  "entry":[ ]}'

describe('POST /webhooks/whatsapp', () => {
  it('queues a correctly signed delivery and answers 200', async () => {
    const { app, queued } = setup()
    const res = await request(app)
      .post('/webhooks/whatsapp')
      .set('content-type', 'application/json')
      .set('x-hub-signature-256', signBody(body, SECRET))
      .send(body)
    expect(res.status).toBe(200)
    expect(queued).toHaveLength(1)
    expect(queued[0]?.payload).toEqual({ object: 'whatsapp_business_account', entry: [] })
    expect(Date.parse(queued[0]!.receivedAt)).not.toBeNaN()
  })

  it('rejects a bad or missing signature with 401 and queues nothing', async () => {
    const { app, queued } = setup()
    const wrong = await request(app)
      .post('/webhooks/whatsapp')
      .set('content-type', 'application/json')
      .set('x-hub-signature-256', signBody(body, 'someone-else'))
      .send(body)
    expect(wrong.status).toBe(401)
    expect(wrong.body.error.code).toBe('UNAUTHENTICATED')

    const missing = await request(app)
      .post('/webhooks/whatsapp')
      .set('content-type', 'application/json')
      .send(body)
    expect(missing.status).toBe(401)
    expect(queued).toHaveLength(0)
  })

  it('verifies the signature before parsing, so junk is 401 not 400', async () => {
    const { app } = setup()
    const res = await request(app)
      .post('/webhooks/whatsapp')
      .set('content-type', 'application/json')
      .send('{not json')
    expect(res.status).toBe(401)
  })

  it('rejects signed junk as 400', async () => {
    const { app } = setup()
    const res = await request(app)
      .post('/webhooks/whatsapp')
      .set('content-type', 'application/json')
      .set('x-hub-signature-256', signBody('{not json', SECRET))
      .send('{not json')
    expect(res.status).toBe(400)
  })

  it('answers 500 when it cannot queue, so Meta retries the delivery', async () => {
    const { app } = setup({ failQueue: true })
    const res = await request(app)
      .post('/webhooks/whatsapp')
      .set('content-type', 'application/json')
      .set('x-hub-signature-256', signBody(body, SECRET))
      .send(body)
    expect(res.status).toBe(500)
  })

  it('answers 503 when the app secret is not configured', async () => {
    const { app } = setup({ appSecret: undefined })
    const res = await request(app).post('/webhooks/whatsapp').send(body)
    expect(res.status).toBe(503)
  })
})

describe('GET /webhooks/whatsapp', () => {
  it('echoes the challenge for the right verify token', async () => {
    const { app } = setup()
    const res = await request(app).get('/webhooks/whatsapp').query({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'verify-me',
      'hub.challenge': '1158201444',
    })
    expect(res.status).toBe(200)
    expect(res.text).toBe('1158201444')
  })

  it('refuses the wrong token', async () => {
    const { app } = setup()
    const res = await request(app).get('/webhooks/whatsapp').query({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'nope',
      'hub.challenge': '1',
    })
    expect(res.status).toBe(403)
  })
})
