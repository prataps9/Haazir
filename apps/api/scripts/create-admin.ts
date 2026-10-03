/**
 * Creates (or promotes) the Haazir super admin who can create organisations.
 *
 *   pnpm admin:create --email pratap@example.com --name Pratap --password '…'
 */
import { parseArgs } from 'node:util'
import { eq } from 'drizzle-orm'
import { createDb, superAdmins, users } from '@haazir/db'
import { loadEnv } from '@haazir/shared/env'
import { createCredentialUser } from '../src/auth/users'

const env = loadEnv()
const { values } = parseArgs({
  options: { email: { type: 'string' }, name: { type: 'string' }, password: { type: 'string' } },
})
if (!values.email || !values.password || values.password.length < 12) {
  console.error(
    'Usage: pnpm admin:create --email you@example.com --name "Your Name" --password "at least 12 characters"',
  )
  process.exit(1)
}

const { db, close } = createDb(env.DATABASE_URL, { max: 1 })
try {
  let [user] = await db.select().from(users).where(eq(users.email, values.email.toLowerCase()))
  user ??= await createCredentialUser(db, {
    name: values.name ?? 'Admin',
    email: values.email,
    password: values.password,
    uiLanguage: 'en',
  })
  await db.insert(superAdmins).values({ userId: user.id }).onConflictDoNothing()
  console.log(`${user.email} is a super admin.`)
} finally {
  await close()
}
