import { eq } from 'drizzle-orm'
import { whatsappAccounts } from '@haazir/db'
import { syncTemplates, type TemplateSyncJob } from '@haazir/messaging'
import { GraphError } from '@haazir/whatsapp'
import type { Deps } from '../deps'

/**
 * Every 15 minutes (spec §10): template statuses from Meta, in case a
 * webhook was missed. One org's failure (an expired token) doesn't stop the rest.
 */
export async function processTemplateSync(deps: Deps, job: TemplateSyncJob) {
  const orgIds = job.orgId
    ? [job.orgId]
    : [
        ...new Set(
          (
            await deps.db
              .select({ orgId: whatsappAccounts.orgId })
              .from(whatsappAccounts)
              .where(eq(whatsappAccounts.status, 'connected'))
          ).map((a) => a.orgId),
        ),
      ]
  let changed = 0
  for (const orgId of orgIds) {
    try {
      const result = await syncTemplates(deps, orgId)
      if (result.changed || result.added) {
        changed += result.changed + result.added
        deps.events.emit(orgId, 'template:updated', {})
      }
    } catch (err) {
      if (!(err instanceof GraphError)) throw err
      deps.log.warn({ orgId, error: err.message }, 'template sync failed')
    }
  }
  return { orgs: orgIds.length, changed }
}
