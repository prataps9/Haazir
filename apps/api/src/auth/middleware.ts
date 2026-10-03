import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { fromNodeHeaders } from 'better-auth/node'
import { eq } from 'drizzle-orm'
import { memberships, organizations, superAdmins, type AnyDatabase } from '@haazir/db'
import { AppError, type Role } from '@haazir/shared'
import type { Auth } from './auth'

export interface AuthedUser {
  id: string
  name: string
  email: string
  uiLanguage: string
  isSuperAdmin: boolean
}

export interface OrgContext {
  id: string
  name: string
  role: Role
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthedUser
      org?: OrgContext
    }
  }
}

/** 401 unless there's a valid session cookie. Sets req.user. */
export function requireUser(auth: Auth, db: AnyDatabase): RequestHandler {
  return async (req, _res, next) => {
    try {
      const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) })
      if (!session) throw new AppError('UNAUTHENTICATED', 'Please log in')
      const [admin] = await db
        .select()
        .from(superAdmins)
        .where(eq(superAdmins.userId, session.user.id))
      req.user = {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        uiLanguage: (session.user as { uiLanguage?: string }).uiLanguage ?? 'hi',
        isSuperAdmin: !!admin,
      }
      next()
    } catch (err) {
      next(err)
    }
  }
}

/**
 * Resolves which org this request acts on (spec §19: tenant isolation starts
 * here). The dashboard sends `X-Org-Id`; it must be one of the user's
 * memberships. With a single membership the header is optional. Every route
 * after this reads `req.org.id` and passes it to every query.
 */
export function orgScope(db: AnyDatabase): RequestHandler {
  return async (req, _res, next) => {
    try {
      if (!req.user) throw new AppError('UNAUTHENTICATED', 'Please log in')
      const rows = await db
        .select({ id: organizations.id, name: organizations.name, role: memberships.role })
        .from(memberships)
        .innerJoin(organizations, eq(organizations.id, memberships.orgId))
        .where(eq(memberships.userId, req.user.id))
      const wanted = req.get('x-org-id')
      const org = wanted
        ? rows.find((r) => r.id === wanted)
        : rows.length === 1
          ? rows[0]
          : undefined
      if (!org) {
        throw wanted
          ? new AppError('FORBIDDEN', 'You are not a member of this organisation')
          : new AppError(
              rows.length ? 'VALIDATION' : 'FORBIDDEN',
              rows.length ? 'Choose an organisation (X-Org-Id)' : 'No organisation yet',
            )
      }
      req.org = org
      next()
    } catch (err) {
      next(err)
    }
  }
}

/**
 * Spec §19 roles: owner (everything), admin (everything but billing and
 * removing members), agent (chat, leads, fees; not settings or campaigns).
 */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.org || !roles.includes(req.org.role)) {
      return next(new AppError('FORBIDDEN', 'Your role cannot do this'))
    }
    next()
  }
}

export const requireSuperAdmin: RequestHandler = (req, _res, next) => {
  if (!req.user?.isSuperAdmin) return next(new AppError('FORBIDDEN', 'Super admin only'))
  next()
}
