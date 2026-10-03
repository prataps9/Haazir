import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { io as connect, type Socket } from 'socket.io-client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEMO_PASSWORD } from '@haazir/db/seed-data'
import { attachRealtime } from '../realtime/socket'
import { createTestApp, ORIGIN } from './helpers'

let t: Awaited<ReturnType<typeof createTestApp>>
let server: Server
let url: string
let realtime: ReturnType<typeof attachRealtime>
const sockets: Socket[] = []

beforeAll(async () => {
  t = await createTestApp()
  server = createServer(t.app)
  realtime = attachRealtime(server, { auth: t.deps.auth, db: t.db, corsOrigins: [ORIGIN] })
  await new Promise<void>((r) => server.listen(0, r))
  url = `http://localhost:${(server.address() as AddressInfo).port}`
})
afterAll(async () => {
  sockets.forEach((s) => s.close())
  await new Promise<void>((r) => realtime.io.close(() => r()))
  await t.close()
})

async function cookieFor(email: string) {
  const res = await fetch(`${url}/api/v1/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify({ email, password: DEMO_PASSWORD }),
  })
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
}

function socketWith(cookie?: string) {
  const s = connect(url, {
    transports: ['websocket'],
    extraHeaders: cookie ? { cookie } : {},
    reconnection: false,
  })
  sockets.push(s)
  return s
}

const join = (s: Socket, orgId: string) =>
  new Promise<{ ok: boolean }>((r) => s.emit('join', orgId, r))

describe('realtime', () => {
  it('refuses a socket without a session', async () => {
    const s = socketWith()
    const error = await new Promise<Error>((r) => s.on('connect_error', r))
    expect(error.message).toBe('unauthenticated')
  })

  it('delivers an org event only to that org, and never lets a user join another org', async () => {
    const a = socketWith(await cookieFor(t.users.owner))
    const b = socketWith(await cookieFor(t.users.secondOwner))
    expect(await join(a, t.orgA.org.id)).toEqual({ ok: true })
    expect(await join(b, t.orgB.org.id)).toEqual({ ok: true })
    expect(await join(b, t.orgA.org.id)).toEqual({ ok: false })

    const receivedA: unknown[] = []
    const receivedB: unknown[] = []
    a.on('handoff', (d) => receivedA.push(d))
    b.on('handoff', (d) => receivedB.push(d))
    realtime.events.emit(t.orgA.org.id, 'handoff', { conversationId: 'c1', summary: 'Hostel' })
    await new Promise((r) => setTimeout(r, 200))
    expect(receivedA).toEqual([{ conversationId: 'c1', summary: 'Hostel' }])
    expect(receivedB).toEqual([])
  })
})
