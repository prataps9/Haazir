import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import { toNodeHandler } from 'better-auth/node'
import { pinoHttp } from 'pino-http'
import { orgScope, requireSuperAdmin, requireUser } from './auth/middleware'
import type { AppDeps } from './deps'
import { errorHandler, notFound } from './middleware/errorHandler'
import { adminRouter } from './routes/admin'
import { analyticsRouter } from './routes/analytics'
import { botRouter } from './routes/bot'
import { contactsRouter } from './routes/contacts'
import { conversationsRouter } from './routes/conversations'
import { coursesRouter } from './routes/courses'
import { demosRouter } from './routes/demos'
import { feesRouter } from './routes/fees'
import { healthRouter } from './routes/health'
import { invitesRouter } from './routes/invites'
import { knowledgeRouter } from './routes/knowledge'
import { leadsRouter } from './routes/leads'
import { mediaRouter } from './routes/media'
import { meRouter, membersRouter } from './routes/me'
import { orgRouter } from './routes/org'
import { pushRouter } from './routes/push'
import { studentsRouter } from './routes/students'
import { razorpayWebhookRouter } from './webhooks/razorpay'
import { whatsappWebhookRouter } from './webhooks/whatsapp'

export type { AppDeps }

/**
 * Builds the Express app without listening, so tests drive it with supertest.
 *
 * Middleware order matters and is fixed here:
 *   1. security headers   2. request logging   3. health (no CORS, no body)
 *   4. webhooks (raw body, signature-checked; no CORS: servers call them)
 *   5. CORS               6. Better Auth (/api/v1/auth/*, reads its own body)
 *   7. JSON body          8. public: invites
 *   9. session required:  /me, push, admin (super admin)
 *  10. org required:      everything else, scoped to req.org
 *  11. 404                12. error handler
 */
export function createApp(deps: AppDeps) {
  const app = express()

  app.disable('x-powered-by')
  app.set('trust proxy', 1)

  app.use(helmet())
  app.use(
    pinoHttp({
      logger: deps.logger,
      // Health probes every few seconds would drown everything else.
      autoLogging: { ignore: (req) => req.url === '/health' || req.url === '/ready' },
    }),
  )

  app.use(healthRouter(deps))
  app.use(whatsappWebhookRouter(deps.whatsapp))
  app.use(razorpayWebhookRouter(deps))

  app.use(cors({ origin: deps.corsOrigins, credentials: true }))
  app.all('/api/v1/auth/*splat', toNodeHandler(deps.auth))
  app.use(express.json({ limit: '1mb' }))

  const api = express.Router()
  api.use(invitesRouter(deps))

  api.use(requireUser(deps.auth, deps.db))
  api.use(meRouter(deps))
  api.use(pushRouter(deps))
  api.use('/admin', requireSuperAdmin)
  api.use(adminRouter(deps))

  api.use(orgScope(deps.db))
  api.use(membersRouter(deps))
  api.use(conversationsRouter(deps))
  api.use(contactsRouter(deps))
  api.use(knowledgeRouter(deps))
  api.use(botRouter(deps))
  api.use(mediaRouter(deps))
  api.use(orgRouter(deps))
  api.use(coursesRouter(deps))
  api.use(leadsRouter(deps))
  api.use(demosRouter(deps))
  api.use(studentsRouter(deps))
  api.use(feesRouter(deps))
  api.use(analyticsRouter(deps))

  app.use('/api/v1', api)

  app.use(notFound)
  app.use(errorHandler)

  return app
}
