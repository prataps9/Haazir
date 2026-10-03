import { hashPassword } from 'better-auth/crypto'
import { accounts, users, type AnyDatabase } from '@haazir/db'

/**
 * Creates a user who logs in with email + password, exactly as Better Auth
 * would store them (a `credential` account holding the password hash), so
 * its sign-in works unchanged. Used by invites and `pnpm admin:create`.
 */
export async function createCredentialUser(
  db: AnyDatabase,
  input: { name: string; email: string; password: string; uiLanguage?: 'hi' | 'en' },
) {
  const [user] = await db
    .insert(users)
    .values({
      name: input.name,
      email: input.email.toLowerCase().trim(),
      emailVerified: true, // they proved the address by using the invite link
      uiLanguage: input.uiLanguage ?? 'hi',
    })
    .returning()
  await db.insert(accounts).values({
    userId: user!.id,
    accountId: user!.id,
    providerId: 'credential',
    password: await hashPassword(input.password),
  })
  return user!
}
