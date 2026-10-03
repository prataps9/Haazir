import { createHash, randomBytes } from 'node:crypto'
import { and, eq, gt, isNull } from 'drizzle-orm'
import { invites, memberships, organizations, users, type AnyDatabase } from '@haazir/db'
import { AppError, type Role } from '@haazir/shared'
import { createCredentialUser } from './users'

const INVITE_DAYS = 7
const hash = (token: string) => createHash('sha256').update(token).digest('hex')

/** Creates an invite and returns the one-time token for the link. */
export async function createInvite(
  db: AnyDatabase,
  input: {
    orgId: string
    email: string
    name?: string
    role: Role
    invitedByUserId?: string
    now?: Date
  },
) {
  const token = randomBytes(24).toString('base64url')
  const now = input.now ?? new Date()
  const [invite] = await db
    .insert(invites)
    .values({
      orgId: input.orgId,
      email: input.email.toLowerCase().trim(),
      name: input.name,
      role: input.role,
      tokenHash: hash(token),
      invitedByUserId: input.invitedByUserId,
      expiresAt: new Date(now.getTime() + INVITE_DAYS * 86_400_000),
    })
    .returning()
  return { invite: invite!, token }
}

async function findOpenInvite(db: AnyDatabase, token: string, now: Date) {
  const [row] = await db
    .select({ invite: invites, orgName: organizations.name })
    .from(invites)
    .innerJoin(organizations, eq(organizations.id, invites.orgId))
    .where(
      and(
        eq(invites.tokenHash, hash(token)),
        isNull(invites.acceptedAt),
        gt(invites.expiresAt, now),
      ),
    )
  if (!row) throw new AppError('NOT_FOUND', 'This invite link has expired or was already used')
  return row
}

/** What the invite page shows before the person sets a password. */
export async function describeInvite(db: AnyDatabase, token: string, now = new Date()) {
  const { invite, orgName } = await findOpenInvite(db, token, now)
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, invite.email))
  return {
    orgName,
    email: invite.email,
    name: invite.name,
    role: invite.role,
    hasAccount: !!existing,
  }
}

/**
 * Accepts an invite: creates the account (new people set a password and
 * language) or, for someone who already has one, just adds the membership.
 * Returns the email so the caller can log them in.
 */
export async function acceptInvite(
  db: AnyDatabase,
  token: string,
  input: { name?: string; password: string; uiLanguage?: 'hi' | 'en' },
  now = new Date(),
) {
  const { invite } = await findOpenInvite(db, token, now)
  let [user] = await db.select().from(users).where(eq(users.email, invite.email))
  if (!user) {
    const name = input.name?.trim() || invite.name
    if (!name) throw new AppError('VALIDATION', 'Please enter your name')
    user = await createCredentialUser(db, {
      name,
      email: invite.email,
      password: input.password,
      uiLanguage: input.uiLanguage,
    })
  }
  await db
    .insert(memberships)
    .values({ orgId: invite.orgId, userId: user.id, role: invite.role })
    .onConflictDoNothing()
  await db.update(invites).set({ acceptedAt: now }).where(eq(invites.id, invite.id))
  return { email: invite.email, orgId: invite.orgId }
}
