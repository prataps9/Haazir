import { and, eq } from 'drizzle-orm'
import { campaignRecipients, campaigns, templates } from '@haazir/db'
import {
  campaignContent,
  campaignValues,
  ensureConversation,
  pendingRecipients,
  queueOutbound,
  quietUntil,
  snapshotAudience,
  unsentQueued,
  type CampaignJob,
  type OutboundJob,
} from '@haazir/messaging'
import { AppError, CAMPAIGN_BATCH_SIZE, CAMPAIGN_SEND_INTERVAL_MS } from '@haazir/shared'
import type { Deps } from '../deps'

/**
 * The `campaign` queue (spec §16.8). The first job snapshots the audience;
 * every job then sends one batch, paced CAMPAIGN_SEND_INTERVAL_MS apart, and
 * queues the next batch for when this one has gone out. Between batches it
 * re-reads the campaign, so a cancel stops it, and the night (9 PM to 8 AM
 * IST) pauses it until morning.
 *
 * Safe to retry: a recipient is claimed and their message row written in one
 * transaction, the outbound jobs are added after it commits (job id = message
 * id), and a retry first re-queues any message whose job never got added.
 */
export async function processCampaign(deps: Deps, job: CampaignJob) {
  const now = deps.now()
  const [campaign] = await deps.db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, job.campaignId), eq(campaigns.orgId, job.orgId)))
  if (!campaign || (campaign.status !== 'scheduled' && campaign.status !== 'sending'))
    return { sent: 0, reason: 'not_sending' }

  const morning = quietUntil(now)
  if (morning) {
    const delay = morning.getTime() - now.getTime()
    await deps.queues.campaign.add('batch', job, {
      jobId: `campaign-${campaign.id}-${morning.getTime()}`,
      delay,
    })
    return { sent: 0, reason: 'quiet_hours' }
  }

  const [template] = campaign.templateId
    ? await deps.db
        .select()
        .from(templates)
        .where(and(eq(templates.id, campaign.templateId), eq(templates.orgId, campaign.orgId)))
    : []
  if (!template || template.status !== 'approved') {
    // Paused or deleted at Meta after scheduling: stop rather than fail 1,000 sends.
    await deps.db
      .update(campaigns)
      .set({ status: 'cancelled', finishedAt: now })
      .where(eq(campaigns.id, campaign.id))
    deps.events.emit(campaign.orgId, 'campaign:updated', { campaignId: campaign.id })
    deps.log.warn({ campaignId: campaign.id }, 'campaign template not approved: cancelled')
    return { sent: 0, reason: 'template_not_approved' }
  }

  if (campaign.status === 'scheduled') {
    await snapshotAudience(deps.db, campaign)
    await deps.db
      .update(campaigns)
      .set({ status: 'sending', startedAt: now })
      .where(and(eq(campaigns.id, campaign.id), eq(campaigns.status, 'scheduled')))
    deps.events.emit(campaign.orgId, 'campaign:updated', { campaignId: campaign.id })
  }

  // A crash after a batch's commit but before its jobs were added: add them now.
  for (const m of await unsentQueued(deps.db, campaign.id))
    await deps.queues.outbound.add('send', { messageId: m.messageId }, { jobId: m.messageId })

  const batch = await pendingRecipients(deps.db, campaign.id, CAMPAIGN_BATCH_SIZE)
  let sent = 0
  for (const r of batch) {
    const values = campaignValues(campaign.variableMap, r)
    const delay = sent * CAMPAIGN_SEND_INTERVAL_MS
    const deferred: { messageId: string }[] = []
    const conversation = await ensureConversation(deps.db, campaign.orgId, r.contactId)
    try {
      await deps.db.transaction(async (tx) => {
        const [claimed] = await tx
          .update(campaignRecipients)
          .set({ status: 'queued' })
          .where(and(eq(campaignRecipients.id, r.id), eq(campaignRecipients.status, 'pending')))
          .returning({ id: campaignRecipients.id })
        if (!claimed) return
        if (!conversation) throw new AppError('VALIDATION', 'no_number')
        const message = await queueOutbound(
          { db: tx, outboundQueue: collect(deferred) },
          {
            orgId: campaign.orgId,
            conversationId: conversation.id,
            content: campaignContent(template, values),
            sentBy: 'campaign',
            bumpConversation: false,
            now,
          },
        )
        await tx
          .update(campaignRecipients)
          .set({ messageId: message.id })
          .where(eq(campaignRecipients.id, r.id))
      })
    } catch (err) {
      if (!(err instanceof AppError)) throw err
      // Opted out since the snapshot, or the content no longer fits: never sent.
      await deps.db
        .update(campaignRecipients)
        .set({
          status: err.code === 'OPTED_OUT' ? 'skipped' : 'failed',
          errorCode: err.code === 'OPTED_OUT' ? 'opted_out' : err.message,
        })
        .where(and(eq(campaignRecipients.id, r.id), eq(campaignRecipients.status, 'pending')))
      continue
    }
    for (const d of deferred)
      await deps.queues.outbound.add('send', d, { jobId: d.messageId, delay })
    if (deferred.length) sent++
  }

  const more = (await pendingRecipients(deps.db, campaign.id, 1)).length > 0
  if (more) {
    await deps.queues.campaign.add('batch', job, {
      jobId: `campaign-${campaign.id}-${now.getTime()}`,
      delay: Math.max(sent, 1) * CAMPAIGN_SEND_INTERVAL_MS,
    })
  } else {
    await deps.db
      .update(campaigns)
      .set({ status: 'done', finishedAt: now })
      .where(and(eq(campaigns.id, campaign.id), eq(campaigns.status, 'sending')))
  }
  deps.events.emit(campaign.orgId, 'campaign:updated', { campaignId: campaign.id })
  return { sent, more }
}

/** Collects outbound jobs so they are added only after the transaction commits. */
function collect(into: { messageId: string }[]) {
  return {
    add: async (_name: string, data: OutboundJob) => {
      into.push(data)
    },
  }
}
