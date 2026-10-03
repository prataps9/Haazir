import { ingestSource } from '@haazir/ai-core'
import type { IngestJob } from '@haazir/messaging'
import type { Deps } from '../deps'

/**
 * The `ingest` queue: turns an FAQ set, pasted text, PDF or website into
 * searchable chunks. Needs an embedding model; without one, the source stays
 * `pending` until a key is set and `pnpm knowledge:reindex` runs.
 */
export async function processIngest(deps: Deps, job: IngestJob) {
  if (!deps.models) {
    deps.log.warn({ sourceId: job.sourceId }, 'no embedding model configured; source left pending')
    return { chunks: 0, skipped: true }
  }
  try {
    return await ingestSource(
      {
        db: deps.db,
        embedding: deps.models.embedding,
        readFile: async (key) => (await deps.storage.get(key)).body,
      },
      job.orgId,
      job.sourceId,
    )
  } finally {
    // Ready or failed, the "teach the bot" screen updates without a refresh.
    deps.events.emit(job.orgId, 'knowledge:updated', { sourceId: job.sourceId })
  }
}
