import { Router } from 'express'
import { and, eq } from 'drizzle-orm'
import { messages } from '@haazir/db'
import { AppError } from '@haazir/shared'
import type { AppDeps } from '../deps'
import { orgOf, uuidParam } from '../lib/http'

/** Photos and voice notes from a chat, streamed from storage to members of the org only. */
export function mediaRouter(deps: Pick<AppDeps, 'db' | 'storage'>) {
  const router = Router()

  router.get('/media/:id', async (req, res) => {
    const { id } = uuidParam.parse(req.params)
    const [message] = await deps.db
      .select({ key: messages.mediaKey, mime: messages.mediaMime })
      .from(messages)
      .where(and(eq(messages.id, id), eq(messages.orgId, orgOf(req).id)))
    if (!message?.key) throw new AppError('NOT_FOUND', 'No media for this message')
    const file = await deps.storage.get(message.key)
    res.setHeader('content-type', message.mime ?? file.contentType ?? 'application/octet-stream')
    res.setHeader('cache-control', 'private, max-age=3600')
    res.setHeader('x-content-type-options', 'nosniff')
    file.body.pipe(res)
  })

  return router
}
