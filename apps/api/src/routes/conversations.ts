import { Router } from 'express'
import { and, asc, desc, eq, ilike, lt, or, sql, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import { moveLead } from '@haazir/coaching'
import { contacts, conversations, leads, memberships, messages, templates, users } from '@haazir/db'
import { HUMAN_MODE_MS } from '@haazir/ai-core'
import {
  campaignContent,
  conversationSummary,
  messageView,
  queueOutbound,
  recipientContext,
} from '@haazir/messaging'
import { AppError, LEAD_STAGES, partsOf, templateParam, variableCount } from '@haazir/shared'
import type { AppDeps } from '../deps'
import { audit, cursor, orgOf, userOf, uuidParam } from '../lib/http'

const PAGE = 30

/**
 * The inbox (spec §9, §16.4). Every query here is scoped to req.org: a
 * conversation id from another org is simply "not found".
 */
export function conversationsRouter(deps: Pick<AppDeps, 'db' | 'queues' | 'events' | 'now'>) {
  const { db } = deps
  const router = Router()

  const loadConversation = async (orgId: string, id: string) => {
    const [row] = await db
      .select(conversationSummary)
      .from(conversations)
      .innerJoin(contacts, eq(contacts.id, conversations.contactId))
      .where(and(eq(conversations.id, id), eq(conversations.orgId, orgId)))
    if (!row) throw new AppError('NOT_FOUND', 'Conversation not found')
    return row
  }

  const announce = async (orgId: string, id: string) => {
    deps.events.emit(orgId, 'conversation:updated', await loadConversation(orgId, id))
  }

  router.get('/conversations', async (req, res) => {
    const org = orgOf(req)
    const q = z
      .object({
        mode: z.enum(['bot', 'human', 'closed']).optional(),
        unread: z.enum(['true', 'false']).optional(),
        stage: z.enum(LEAD_STAGES).optional(),
        q: z.string().trim().max(100).optional(),
        cursor: z.string().optional(),
      })
      .parse(req.query)
    const after = cursor.decode(q.cursor)
    const filters: (SQL | undefined)[] = [
      eq(conversations.orgId, org.id),
      // The bot's own test conversations never show in the inbox.
      sql`${contacts.waId} not like 'playground-%'`,
      q.mode ? eq(conversations.mode, q.mode) : undefined,
      q.unread === 'true' ? sql`${conversations.unreadCount} > 0` : undefined,
      q.stage
        ? sql`exists (select 1 from ${leads} where ${leads.contactId} = ${conversations.contactId} and ${leads.orgId} = ${conversations.orgId} and ${leads.stage} = ${q.stage})`
        : undefined,
      q.q
        ? or(
            ilike(contacts.name, `%${q.q}%`),
            ilike(contacts.profileName, `%${q.q}%`),
            ilike(contacts.waId, `%${q.q}%`),
            ilike(conversations.lastMessagePreview, `%${q.q}%`),
          )
        : undefined,
      after
        ? or(
            lt(conversations.lastMessageAt, after.at ?? new Date(0)),
            and(
              eq(conversations.lastMessageAt, after.at ?? new Date(0)),
              lt(conversations.id, after.id),
            ),
          )
        : undefined,
    ]
    const rows = await db
      .select(conversationSummary)
      .from(conversations)
      .innerJoin(contacts, eq(contacts.id, conversations.contactId))
      .where(and(...filters))
      .orderBy(sql`${conversations.lastMessageAt} desc nulls last`, desc(conversations.id))
      .limit(PAGE + 1)
    const page = rows.slice(0, PAGE)
    const last = page.at(-1)
    res.json({
      conversations: page,
      nextCursor: rows.length > PAGE && last ? cursor.encode(last.lastMessageAt, last.id) : null,
    })
  })

  router.get('/conversations/:id', async (req, res) => {
    const { id } = uuidParam.parse(req.params)
    res.json(await loadConversation(orgOf(req).id, id))
  })

  router.get('/conversations/:id/messages', async (req, res) => {
    const org = orgOf(req)
    const { id } = uuidParam.parse(req.params)
    await loadConversation(org.id, id)
    const after = cursor.decode(z.string().optional().parse(req.query.cursor))
    const rows = await db
      .select(messageView)
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, id),
          eq(messages.orgId, org.id),
          after
            ? or(
                lt(messages.createdAt, after.at!),
                and(eq(messages.createdAt, after.at!), lt(messages.id, after.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(PAGE * 2 + 1)
    const page = rows.slice(0, PAGE * 2)
    const last = page.at(-1)
    res.json({
      // Oldest first, ready to render; the cursor loads the page before these.
      messages: page.reverse(),
      nextCursor: rows.length > PAGE * 2 && last ? cursor.encode(last.createdAt, last.id) : null,
    })
  })

  /**
   * After staff send anything: the chat is theirs for a while (the bot stays
   * quiet), and a new enquiry becomes "contacted".
   */
  const afterStaffSend = async (
    req: Parameters<typeof orgOf>[0],
    id: string,
    current: Awaited<ReturnType<typeof loadConversation>>,
    messageId: string,
    now: Date,
  ) => {
    const org = orgOf(req)
    const user = userOf(req)
    await db
      .update(conversations)
      .set({
        mode: 'human',
        humanUntil: new Date(now.getTime() + HUMAN_MODE_MS),
        assignedUserId: user.id,
      })
      .where(and(eq(conversations.id, id), eq(conversations.orgId, org.id)))
    if (current.mode !== 'human') {
      await audit(db, req, {
        action: 'conversation.takeover',
        entity: 'conversation',
        entityId: id,
        diff: { via: 'reply' },
      })
    }
    // A person on the team has now answered: a new enquiry becomes "contacted".
    const [lead] = await db
      .select({ id: leads.id, stage: leads.stage })
      .from(leads)
      .where(and(eq(leads.orgId, org.id), eq(leads.contactId, current.contact.id)))
    if (lead?.stage === 'new') {
      await moveLead(db, {
        orgId: org.id,
        leadId: lead.id,
        to: 'contacted',
        actor: 'user',
        actorUserId: user.id,
        onlyForward: true,
        now,
      })
      deps.events.emit(org.id, 'lead:updated', { leadId: lead.id })
    }
    const [view] = await db.select(messageView).from(messages).where(eq(messages.id, messageId))
    deps.events.emit(org.id, 'message:new', view)
    await announce(org.id, id)
    return view
  }

  /** Staff reply (window-checked). Replying also takes the chat over from the bot. */
  router.post('/conversations/:id/messages', async (req, res) => {
    const org = orgOf(req)
    const user = userOf(req)
    const { id } = uuidParam.parse(req.params)
    const { text } = z.object({ text: z.string().trim().min(1).max(4096) }).parse(req.body)
    const current = await loadConversation(org.id, id)
    const now = deps.now()

    const message = await queueOutbound(
      { db, outboundQueue: deps.queues.outbound },
      {
        orgId: org.id,
        conversationId: id,
        content: { kind: 'text', body: text },
        sentBy: 'user',
        sentByUserId: user.id,
        now,
      },
    )
    res.status(201).json(await afterStaffSend(req, id, current, message.id, now))
  })

  /**
   * The approved templates staff can send here once the 24-hour window has
   * closed (spec §16.4), with this person's name, course and batch filled in
   * where the template asks for them.
   */
  router.get('/conversations/:id/templates', async (req, res) => {
    const org = orgOf(req)
    const { id } = uuidParam.parse(req.params)
    const current = await loadConversation(org.id, id)
    const [who] = await db
      .select(recipientContext)
      .from(contacts)
      .innerJoin(conversations, eq(conversations.contactId, contacts.id))
      .where(and(eq(contacts.id, current.contact.id), eq(contacts.orgId, org.id)))
    const rows = await db
      .select()
      .from(templates)
      .where(and(eq(templates.orgId, org.id), eq(templates.status, 'approved')))
      .orderBy(asc(templates.purpose), asc(templates.name))
    res.json({
      templates: rows.map((t) => {
        const parts = partsOf(t.components)
        const n = variableCount(parts.body)
        return {
          id: t.id,
          name: t.name,
          language: t.language,
          category: t.category,
          purpose: t.purpose,
          body: parts.body,
          variables: t.variables,
          suggested: Array.from({ length: n }, (_, i) => {
            const v = t.variables[i] ?? ''
            if (['contact_name', 'name', 'student_name'].includes(v)) return who?.name ?? ''
            if (v === 'course') return who?.course ?? ''
            if (v === 'batch') return who?.batch ?? ''
            return ''
          }),
        }
      }),
    })
  })

  /** Sends an approved template (any time: templates don't need the window). */
  router.post('/conversations/:id/template', async (req, res) => {
    const org = orgOf(req)
    const user = userOf(req)
    const { id } = uuidParam.parse(req.params)
    const body = z
      .object({
        templateId: z.uuid(),
        values: z.array(z.string().trim().min(1, 'Fill in every blank').max(200)).max(20),
      })
      .parse(req.body)
    const current = await loadConversation(org.id, id)
    const [t] = await db
      .select()
      .from(templates)
      .where(and(eq(templates.id, body.templateId), eq(templates.orgId, org.id)))
    if (!t) throw new AppError('NOT_FOUND', 'Template not found')
    if (t.status !== 'approved')
      throw new AppError('TEMPLATE_NOT_APPROVED', 'Only an approved template can be sent')
    if (body.values.length !== variableCount(partsOf(t.components).body))
      throw new AppError('VALIDATION', 'Fill in every blank', { reason: 'variables_missing' })
    const now = deps.now()
    const message = await queueOutbound(
      { db, outboundQueue: deps.queues.outbound },
      {
        orgId: org.id,
        conversationId: id,
        content: campaignContent(t, body.values.map(templateParam)),
        sentBy: 'user',
        sentByUserId: user.id,
        now,
      },
    )
    res.status(201).json(await afterStaffSend(req, id, current, message.id, now))
  })

  /** "Chat khud sambhalein": staff take over; the bot stays quiet for 2h of staff silence. */
  router.post('/conversations/:id/takeover', async (req, res) => {
    const org = orgOf(req)
    const { id } = uuidParam.parse(req.params)
    await loadConversation(org.id, id)
    await db
      .update(conversations)
      .set({
        mode: 'human',
        humanUntil: new Date(deps.now().getTime() + HUMAN_MODE_MS),
        assignedUserId: userOf(req).id,
      })
      .where(and(eq(conversations.id, id), eq(conversations.orgId, org.id)))
    await audit(db, req, { action: 'conversation.takeover', entity: 'conversation', entityId: id })
    await announce(org.id, id)
    res.json(await loadConversation(org.id, id))
  })

  /** "Bot ko wapas dein": the bot answers again from the next message. */
  router.post('/conversations/:id/handback', async (req, res) => {
    const org = orgOf(req)
    const { id } = uuidParam.parse(req.params)
    await loadConversation(org.id, id)
    await db
      .update(conversations)
      .set({
        mode: 'bot',
        humanUntil: null,
        handoffReason: null,
        handoffSummary: null,
        handoffAt: null,
      })
      .where(and(eq(conversations.id, id), eq(conversations.orgId, org.id)))
    await audit(db, req, { action: 'conversation.handback', entity: 'conversation', entityId: id })
    await announce(org.id, id)
    res.json(await loadConversation(org.id, id))
  })

  router.post('/conversations/:id/read', async (req, res) => {
    const org = orgOf(req)
    const { id } = uuidParam.parse(req.params)
    await db
      .update(conversations)
      .set({ unreadCount: 0 })
      .where(and(eq(conversations.id, id), eq(conversations.orgId, org.id)))
    await announce(org.id, id)
    res.json({ ok: true })
  })

  /** Assign to a member of this org (or unassign with null). */
  router.patch('/conversations/:id', async (req, res) => {
    const org = orgOf(req)
    const { id } = uuidParam.parse(req.params)
    const { assignedUserId } = z.object({ assignedUserId: z.uuid().nullable() }).parse(req.body)
    await loadConversation(org.id, id)
    if (assignedUserId) {
      const [member] = await db
        .select({ id: users.id })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(and(eq(memberships.orgId, org.id), eq(memberships.userId, assignedUserId)))
      if (!member)
        throw new AppError('VALIDATION', 'That person is not a member of this organisation')
    }
    await db
      .update(conversations)
      .set({ assignedUserId })
      .where(and(eq(conversations.id, id), eq(conversations.orgId, org.id)))
    await announce(org.id, id)
    res.json(await loadConversation(org.id, id))
  })

  return router
}
