import type { Request } from 'express'
import { z } from 'zod'
import { auditLogs, type AnyDatabase } from '@haazir/db'
import { AppError } from '@haazir/shared'

export const uuidParam = z.object({ id: z.uuid({ message: 'Not a valid id' }) })

/** The org this request acts on; orgScope guarantees it on org routes. */
export function orgOf(req: Request) {
  if (!req.org) throw new AppError('FORBIDDEN', 'No organisation selected')
  return req.org
}

export function userOf(req: Request) {
  if (!req.user) throw new AppError('UNAUTHENTICATED', 'Please log in')
  return req.user
}

/**
 * Opaque cursors for "load more" (spec §9: cursor pagination wherever lists
 * grow). Encodes the sort key and id of the last row seen.
 */
export const cursor = {
  encode: (at: Date | null, id: string) =>
    Buffer.from(`${at ? at.toISOString() : ''}|${id}`).toString('base64url'),
  decode(raw: string | undefined): { at: Date | null; id: string } | null {
    if (!raw) return null
    const [at, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|')
    if (!id || !/^[0-9a-f-]{36}$/.test(id)) throw new AppError('VALIDATION', 'Bad cursor')
    return { at: at ? new Date(at) : null, id }
  },
}

/** Spec §19 audit trail: takeovers, settings changes, org creation. */
export async function audit(
  db: AnyDatabase,
  req: Request,
  entry: {
    orgId?: string | null
    action: string
    entity: string
    entityId?: string
    diff?: Record<string, unknown>
  },
) {
  await db.insert(auditLogs).values({
    orgId: entry.orgId ?? req.org?.id ?? null,
    actorUserId: req.user?.id ?? null,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId,
    diff: entry.diff,
    ip: req.ip,
  })
}
