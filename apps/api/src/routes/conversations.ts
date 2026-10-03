import { Router } from 'express'
import { and, desc, eq, ilike, lt, or, sql, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import { contacts, conversations, memberships, messages, users } from '@haazir/db'
import { HUMAN_MODE_MS } from '@haazir/ai-core'
import { conversationSummary, messageView, queueOutbound } from '@haazir/messaging'
import { AppError } from '@haazir/shared'
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
    const [view] = await db.select(messageView).from(messages).where(eq(messages.id, message.id))
    deps.events.emit(org.id, 'message:new', view)
    await announce(org.id, id)
    res.status(201).json(view)
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
