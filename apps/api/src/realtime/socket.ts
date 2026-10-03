import type { Server as HttpServer } from 'node:http'
import { createAdapter } from '@socket.io/redis-adapter'
import { fromNodeHeaders } from 'better-auth/node'
import { and, eq } from 'drizzle-orm'
import type { Redis } from 'ioredis'
import { Server } from 'socket.io'
import { memberships, type AnyDatabase } from '@haazir/db'
import type { OrgEvents } from '@haazir/messaging'
import type { Auth } from '../auth/auth'

export const orgRoom = (orgId: string) => `org:${orgId}`

/**
 * The live inbox (spec §7): one Socket.IO room per org. A socket proves who
 * it is with the same session cookie as the API, and can only join rooms of
 * orgs its user belongs to. With Redis, events from the worker (and from other
 * API instances) reach every connected dashboard.
 */
export function attachRealtime(
  server: HttpServer,
  deps: { auth: Auth; db: AnyDatabase; corsOrigins: string[]; redis?: { pub: Redis; sub: Redis } },
): { io: Server; events: OrgEvents } {
  const io = new Server(server, {
    cors: { origin: deps.corsOrigins, credentials: true },
    serveClient: false,
  })
  if (deps.redis) io.adapter(createAdapter(deps.redis.pub, deps.redis.sub))

  io.use(async (socket, next) => {
    try {
      const session = await deps.auth.api.getSession({
        headers: fromNodeHeaders(socket.request.headers),
      })
      if (!session) return next(new Error('unauthenticated'))
      socket.data.userId = session.user.id
      next()
    } catch {
      next(new Error('unauthenticated'))
    }
  })

  io.on('connection', (socket) => {
    socket.on('join', async (orgId: unknown, ack?: (r: { ok: boolean }) => void) => {
      if (typeof orgId !== 'string' || !/^[0-9a-f-]{36}$/.test(orgId)) return ack?.({ ok: false })
      const [member] = await deps.db
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(eq(memberships.orgId, orgId), eq(memberships.userId, socket.data.userId as string)),
        )
      if (!member) return ack?.({ ok: false })
      // One org at a time: switching org leaves the previous room.
      for (const room of socket.rooms) if (room.startsWith('org:')) await socket.leave(room)
      await socket.join(orgRoom(orgId))
      ack?.({ ok: true })
    })
  })

  return {
    io,
    events: { emit: (orgId, event, data) => void io.to(orgRoom(orgId)).emit(event, data) },
  }
}
