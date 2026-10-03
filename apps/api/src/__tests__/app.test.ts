import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WORKER_HEARTBEAT_KEY } from '@haazir/shared'
import { createApp, type AppDeps } from '../app'
import { createTestApp } from './helpers'

let base: Awaited<ReturnType<typeof createTestApp>>
beforeAll(async () => {
  base = await createTestApp()
})
afterAll(() => base.close())

function makeApp(overrides: Partial<AppDeps> = {}) {
  const store = new Map<string, string>([[WORKER_HEARTBEAT_KEY, new Date().toISOString()]])
  return createApp({
    ...base.deps,
    corsOrigins: ['http://localhost:5173'],
    database: { ping: async () => {} },
    redis: { ping: async () => 'PONG', get: async (k) => store.get(k) ?? null },
    ...overrides,
  })
}

const failing = async () => {
  throw new Error('connection refused')
}

describe('GET /health', () => {
  it('is up without touching dependencies', async () => {
    const app = makeApp({ database: { ping: failing }, redis: { ping: failing, get: failing } })
    const res = await request(app).get('/health')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
  })

  it('sends security headers and hides Express', async () => {
    const res = await request(makeApp()).get('/health')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['x-powered-by']).toBeUndefined()
  })
})

describe('GET /ready', () => {
  it('is ready when Postgres and Redis answer', async () => {
    const res = await request(makeApp()).get('/ready')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      status: 'ready',
      checks: { database: 'ok', redis: 'ok', worker: 'ok' },
    })
  })

  it('returns 503 when Postgres is down', async () => {
    const res = await request(makeApp({ database: { ping: failing } })).get('/ready')
    expect(res.status).toBe(503)
    expect(res.body.checks.database).toBe('down')
  })

  it('returns 503 when Redis is down, and cannot vouch for the worker', async () => {
    const res = await request(makeApp({ redis: { ping: failing, get: failing } })).get('/ready')
    expect(res.status).toBe(503)
    expect(res.body.checks).toMatchObject({ redis: 'down', worker: 'unknown' })
  })

  it('stays ready but flags a stale worker heartbeat', async () => {
    const old = new Date(Date.now() - 10 * 60_000).toISOString()
    const res = await request(
      makeApp({ redis: { ping: async () => 'PONG', get: async () => old } }),
    ).get('/ready')
    expect(res.status).toBe(200)
    expect(res.body.checks.worker).toBe('stale')
  })
})

describe('errors', () => {
  it('uses the standard error shape for unknown routes', async () => {
    const res = await request(makeApp()).get('/nope')
    expect(res.status).toBe(404)
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'No route for GET /nope' },
    })
  })

  it('asks for a login before revealing whether an API route exists', async () => {
    const res = await request(makeApp()).get('/api/v1/nope')
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHENTICATED')
  })

  it('turns malformed JSON into VALIDATION, not a stack trace', async () => {
    const res = await request(makeApp())
      .post('/api/v1/anything')
      .set('content-type', 'application/json')
      .send('{"broken":')
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION')
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.js/)
  })
})

describe('CORS', () => {
  it('allows the dashboard origin only', async () => {
    const ok = await request(makeApp())
      .options('/api/v1/anything')
      .set('origin', 'http://localhost:5173')
      .set('access-control-request-method', 'GET')
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173')

    const denied = await request(makeApp())
      .options('/api/v1/anything')
      .set('origin', 'https://evil.example')
      .set('access-control-request-method', 'GET')
    expect(denied.headers['access-control-allow-origin']).toBeUndefined()
  })
})
