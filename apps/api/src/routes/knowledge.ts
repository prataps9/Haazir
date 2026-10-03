import { Router } from 'express'
import multer from 'multer'
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { askInPlayground } from '@haazir/ai-core'
import { knowledgeFaqs, knowledgeSources, unansweredQuestions, type AnyDatabase } from '@haazir/db'
import { AppError } from '@haazir/shared'
import { requireRole } from '../auth/middleware'
import type { AppDeps } from '../deps'
import { audit, orgOf, userOf, uuidParam } from '../lib/http'

const FAQ_SOURCE_TITLE = 'Sawaal-Jawab'
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
})

const sourceView = {
  id: knowledgeSources.id,
  type: knowledgeSources.type,
  title: knowledgeSources.title,
  url: knowledgeSources.url,
  status: knowledgeSources.status,
  error: knowledgeSources.error,
  chunkCount: knowledgeSources.chunkCount,
  createdAt: knowledgeSources.createdAt,
}

/** The org's FAQ source, created on first use: every FAQ lives in one. */
async function faqSourceId(db: AnyDatabase, orgId: string) {
  const [existing] = await db
    .select({ id: knowledgeSources.id })
    .from(knowledgeSources)
    .where(
      and(
        eq(knowledgeSources.orgId, orgId),
        eq(knowledgeSources.type, 'faq'),
        eq(knowledgeSources.title, FAQ_SOURCE_TITLE),
      ),
    )
  if (existing) return existing.id
  const [created] = await db
    .insert(knowledgeSources)
    .values({ orgId, type: 'faq', title: FAQ_SOURCE_TITLE })
    .returning({ id: knowledgeSources.id })
  return created!.id
}

/** "Bot ko sikhayein" (spec §16.10): documents, FAQs, unanswered questions, test box. */
export function knowledgeRouter(
  deps: Pick<AppDeps, 'db' | 'queues' | 'storage' | 'models' | 'events' | 'now'>,
) {
  const { db } = deps
  const router = Router()
  const teach = requireRole('owner', 'admin')

  const reingest = async (orgId: string, sourceId: string) => {
    await db
      .update(knowledgeSources)
      .set({ status: 'pending' })
      .where(eq(knowledgeSources.id, sourceId))
    await deps.queues.ingest.add('ingest', { orgId, sourceId })
    deps.events.emit(orgId, 'knowledge:updated', { sourceId })
  }

  router.get('/knowledge/sources', async (req, res) => {
    const rows = await db
      .select(sourceView)
      .from(knowledgeSources)
      .where(eq(knowledgeSources.orgId, orgOf(req).id))
      .orderBy(desc(knowledgeSources.createdAt))
    res.json({ sources: rows })
  })

  /** Pasted text or a website link (JSON), or a PDF brochure (multipart field "file"). */
  router.post('/knowledge/sources', teach, upload.single('file'), async (req, res) => {
    const org = orgOf(req)
    let values: typeof knowledgeSources.$inferInsert
    if (req.file) {
      if (req.file.mimetype !== 'application/pdf')
        throw new AppError('VALIDATION', 'Only PDF files can be uploaded')
      const title =
        z.string().trim().max(200).optional().parse(req.body?.title) || req.file.originalname
      values = { orgId: org.id, type: 'pdf', title }
    } else {
      const body = z
        .discriminatedUnion('type', [
          z.object({
            type: z.literal('text'),
            title: z.string().trim().min(1).max(200),
            text: z.string().trim().min(20).max(200_000),
          }),
          z.object({
            type: z.literal('url'),
            url: z.url().refine((u) => /^https?:/.test(u), 'Use an http(s) link'),
            title: z.string().trim().max(200).optional(),
          }),
        ])
        .parse(req.body)
      values =
        body.type === 'text'
          ? { orgId: org.id, type: 'text', title: body.title, textContent: body.text }
          : {
              orgId: org.id,
              type: 'url',
              title: body.title || new URL(body.url).hostname,
              url: body.url,
            }
    }
    const [source] = await db.insert(knowledgeSources).values(values).returning()
    if (req.file) {
      const key = `orgs/${org.id}/knowledge/${source!.id}.pdf`
      await deps.storage.put(key, req.file.buffer, 'application/pdf')
      await db
        .update(knowledgeSources)
        .set({ fileKey: key })
        .where(eq(knowledgeSources.id, source!.id))
    }
    await reingest(org.id, source!.id)
    await audit(db, req, {
      action: 'knowledge.added',
      entity: 'knowledge_source',
      entityId: source!.id,
      diff: { type: source!.type },
    })
    const [view] = await db
      .select(sourceView)
      .from(knowledgeSources)
      .where(eq(knowledgeSources.id, source!.id))
    res.status(201).json(view)
  })

  router.delete('/knowledge/sources/:id', teach, async (req, res) => {
    const org = orgOf(req)
    const { id } = uuidParam.parse(req.params)
    const deleted = await db
      .delete(knowledgeSources)
      .where(and(eq(knowledgeSources.id, id), eq(knowledgeSources.orgId, org.id)))
      .returning({ id: knowledgeSources.id, fileKey: knowledgeSources.fileKey })
    if (!deleted.length) throw new AppError('NOT_FOUND', 'Source not found')
    if (deleted[0]!.fileKey) await deps.storage.delete(deleted[0]!.fileKey).catch(() => {})
    await audit(db, req, { action: 'knowledge.deleted', entity: 'knowledge_source', entityId: id })
    deps.events.emit(org.id, 'knowledge:updated', { sourceId: id })
    res.status(204).end()
  })

  const faqBody = z.object({
    question: z.string().trim().min(3).max(500),
    answer: z.string().trim().min(1).max(2000),
  })

  router.get('/knowledge/faqs', async (req, res) => {
    const rows = await db
      .select({
        id: knowledgeFaqs.id,
        question: knowledgeFaqs.question,
        answer: knowledgeFaqs.answer,
        sourceId: knowledgeFaqs.sourceId,
        updatedAt: knowledgeFaqs.updatedAt,
      })
      .from(knowledgeFaqs)
      .where(eq(knowledgeFaqs.orgId, orgOf(req).id))
      .orderBy(desc(knowledgeFaqs.updatedAt))
    res.json({ faqs: rows })
  })

  router.post('/knowledge/faqs', teach, async (req, res) => {
    const org = orgOf(req)
    const body = faqBody.parse(req.body)
    const sourceId = await faqSourceId(db, org.id)
    const [faq] = await db
      .insert(knowledgeFaqs)
      .values({ ...body, orgId: org.id, sourceId })
      .returning()
    await reingest(org.id, sourceId)
    res.status(201).json(faq)
  })

  router.patch('/knowledge/faqs/:id', teach, async (req, res) => {
    const org = orgOf(req)
    const { id } = uuidParam.parse(req.params)
    const body = faqBody.partial().parse(req.body)
    const [faq] = await db
      .update(knowledgeFaqs)
      .set(body)
      .where(and(eq(knowledgeFaqs.id, id), eq(knowledgeFaqs.orgId, org.id)))
      .returning()
    if (!faq) throw new AppError('NOT_FOUND', 'FAQ not found')
    await reingest(org.id, faq.sourceId)
    res.json(faq)
  })

  router.delete('/knowledge/faqs/:id', teach, async (req, res) => {
    const org = orgOf(req)
    const { id } = uuidParam.parse(req.params)
    const [faq] = await db
      .delete(knowledgeFaqs)
      .where(and(eq(knowledgeFaqs.id, id), eq(knowledgeFaqs.orgId, org.id)))
      .returning()
    if (!faq) throw new AppError('NOT_FOUND', 'FAQ not found')
    await reingest(org.id, faq.sourceId)
    res.status(204).end()
  })

  /** Questions the bot couldn't answer, most asked first. */
  router.get('/knowledge/unanswered', async (req, res) => {
    const rows = await db
      .select({
        id: unansweredQuestions.id,
        question: unansweredQuestions.question,
        count: unansweredQuestions.count,
        lastSeenAt: unansweredQuestions.lastSeenAt,
      })
      .from(unansweredQuestions)
      .where(
        and(eq(unansweredQuestions.orgId, orgOf(req).id), eq(unansweredQuestions.resolved, false)),
      )
      .orderBy(desc(unansweredQuestions.count), desc(unansweredQuestions.lastSeenAt))
      .limit(100)
    res.json({ questions: rows })
  })

  /** "Jawab likhein": the answer becomes an FAQ and the bot learns it. */
  router.post('/knowledge/unanswered/:id/resolve', teach, async (req, res) => {
    const org = orgOf(req)
    const { id } = uuidParam.parse(req.params)
    const { answer, question } = z
      .object({
        answer: z.string().trim().min(1).max(2000),
        question: z.string().trim().min(3).max(500).optional(),
      })
      .parse(req.body)
    const [q] = await db
      .update(unansweredQuestions)
      .set({ resolved: true })
      .where(and(eq(unansweredQuestions.id, id), eq(unansweredQuestions.orgId, org.id)))
      .returning()
    if (!q) throw new AppError('NOT_FOUND', 'Question not found')
    const sourceId = await faqSourceId(db, org.id)
    const [faq] = await db
      .insert(knowledgeFaqs)
      .values({ orgId: org.id, sourceId, question: question ?? q.question, answer })
      .returning()
    await reingest(org.id, sourceId)
    res.status(201).json(faq)
  })

  /** The test box: the real pipeline on a private conversation, nothing sent. */
  router.post('/knowledge/test', async (req, res) => {
    const org = orgOf(req)
    const { question, reset } = z
      .object({ question: z.string().trim().min(1).max(1000), reset: z.boolean().optional() })
      .parse(req.body)
    const result = await askInPlayground(
      { db, models: deps.models, now: deps.now },
      { orgId: org.id, ownerKey: userOf(req).id, question, reset },
    )
    res.json(playgroundView(result))
  })

  return router
}

/** The playground result as the dashboard shows it. */
export function playgroundView(result: Awaited<ReturnType<typeof askInPlayground>>) {
  const d = result.decision
  const content = 'content' in d ? d.content : null
  return {
    kind: d.kind,
    reply: content?.body ?? null,
    buttons: content?.kind === 'buttons' ? content.buttons : [],
    handoff: d.kind === 'handoff' ? { reason: d.reason, summary: d.summary } : null,
    understood:
      'trace' in d
        ? { intent: d.trace.intent, language: d.trace.language, confidence: d.trace.confidence }
        : null,
    tools: 'trace' in d ? d.trace.toolCalls.map((t) => t.name) : [],
    guardrailFlags: 'trace' in d ? d.trace.guardrailFlags : [],
    sources: result.sources,
  }
}
