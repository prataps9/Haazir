import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { auditLogs, contacts, segments } from '@haazir/db'
import { createTestApp } from './helpers'

let t: Awaited<ReturnType<typeof createTestApp>>
beforeAll(async () => {
  t = await createTestApp()
})
afterAll(() => t.close())

const api = (path: string) => `/api/v1${path}`
const mine = (waId: string) =>
  t.db
    .select()
    .from(contacts)
    .where(and(eq(contacts.orgId, t.orgA.org.id), eq(contacts.waId, waId)))
    .then((r) => r[0])

describe('importing a list', () => {
  it('only owners and admins can', async () => {
    const staff = await t.login(t.users.staff)
    const res = await staff.post(api('/contacts/import')).send({ rows: [{ phone: '9811100001' }] })
    expect(res.status).toBe(403)
  })

  it('creates contacts, tidies numbers, merges repeats, and reports rows it could not read', async () => {
    const owner = await t.login(t.users.owner)
    const res = await owner.post(api('/contacts/import')).send({
      tags: ['old-register'],
      rows: [
        { phone: '98111 00001', name: 'Sunita Sharma', tags: ['neet'] },
        { phone: '+91-9811100001', tags: ['parent'] }, // the same person again
        { phone: '09811100002' },
        { phone: 'not a number', name: 'Bad row' },
      ],
    })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ created: 2, updated: 0, optedIn: 0, invalid: [4] })
    const sunita = await mine('919811100001')
    expect(sunita).toMatchObject({ name: 'Sunita Sharma', optInStatus: 'unknown' })
    expect(sunita!.tags.sort()).toEqual(['neet', 'old-register', 'parent'])
  })

  it('a consent column alone is not enough: the uploader must declare it', async () => {
    const owner = await t.login(t.users.owner)
    await owner
      .post(api('/contacts/import'))
      .send({ rows: [{ phone: '9811100003', consent: true }] })
    expect(await mine('919811100003')).toMatchObject({ optInStatus: 'unknown', optInSource: null })

    const res = await owner.post(api('/contacts/import')).send({
      consentDeclared: true,
      rows: [
        { phone: '9811100003', consent: true },
        { phone: '9811100004', consent: false },
        { phone: '9811100005' },
      ],
    })
    expect(res.body).toMatchObject({ created: 2, updated: 1, optedIn: 1 })
    const yes = await mine('919811100003')
    expect(yes).toMatchObject({ optInStatus: 'opted_in', optInSource: 'import' })
    expect(yes!.optInAt).toBeInstanceOf(Date)
    expect(await mine('919811100004')).toMatchObject({ optInStatus: 'unknown' })
    expect(await mine('919811100005')).toMatchObject({ optInStatus: 'unknown' })
  })

  it('a list never undoes a STOP, and the import is in the audit log', async () => {
    const owner = await t.login(t.users.owner)
    await t.db
      .insert(contacts)
      .values({ orgId: t.orgA.org.id, waId: '919811100009', optInStatus: 'opted_out' })
    const res = await owner.post(api('/contacts/import')).send({
      consentDeclared: true,
      rows: [{ phone: '9811100009', consent: true, name: 'Said stop' }],
    })
    expect(res.body.optedIn).toBe(0)
    expect(await mine('919811100009')).toMatchObject({
      optInStatus: 'opted_out',
      name: 'Said stop',
    })
    const logs = await t.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'contacts.imported'))
    expect(logs.at(-1)?.diff).toMatchObject({ consentDeclared: true, rows: 1 })
  })

  it("another org's contact with the same number is untouched", async () => {
    const owner = await t.login(t.users.owner)
    const before = await t.db.select().from(contacts).where(eq(contacts.id, t.orgB.contact.id))
    await owner.post(api('/contacts/import')).send({
      consentDeclared: true,
      rows: [{ phone: before[0]!.waId, name: 'Overwritten?', consent: true, tags: ['x'] }],
    })
    const after = await t.db.select().from(contacts).where(eq(contacts.id, t.orgB.contact.id))
    expect(after[0]).toEqual(before[0])
  })
})

describe('the contacts list', () => {
  it('lists this org only, filters by consent, tag and search, and hides test and team contacts', async () => {
    const owner = await t.login(t.users.owner)
    const all = await owner.get(api('/contacts'))
    expect(all.status).toBe(200)
    expect(all.body.total).toBe(all.body.contacts.length)
    const ids = all.body.contacts.map((c: { id: string }) => c.id)
    expect(ids).toContain(t.orgA.contact.id)
    expect(ids).not.toContain(t.orgB.contact.id)

    const yes = await owner.get(api('/contacts?consent=opted_in'))
    // The declared yes from the list, and the number imported in the test above.
    expect(yes.body.contacts.map((c: { waId: string }) => c.waId).sort()).toEqual(
      ['919811100003', t.orgB.contact.waId].sort(),
    )
    const tagged = await owner.get(api('/contacts?tag=neet'))
    expect(tagged.body.contacts.map((c: { waId: string }) => c.waId)).toEqual(['919811100001'])
    const found = await owner.get(api('/contacts?q=sunita'))
    expect(found.body.total).toBe(1)
  })

  it('lists the tags in use with how many people have each', async () => {
    const owner = await t.login(t.users.owner)
    const res = await owner.get(api('/contacts/tags'))
    expect(res.body.tags).toContainEqual({ tag: 'old-register', count: 2 })
    expect(res.body.tags).toContainEqual({ tag: 'neet', count: 1 })
  })

  it('bulk tagging adds and removes, and ignores ids from another org', async () => {
    const staff = await t.login(t.users.staff)
    const a = await mine('919811100001')
    const res = await staff.post(api('/contacts/bulk-tag')).send({
      ids: [a!.id, t.orgB.contact.id],
      add: ['diwali-offer'],
      remove: ['parent'],
    })
    expect(res.body).toEqual({ updated: 1 })
    expect((await mine('919811100001'))!.tags.sort()).toEqual([
      'diwali-offer',
      'neet',
      'old-register',
    ])
    const [b] = await t.db.select().from(contacts).where(eq(contacts.id, t.orgB.contact.id))
    expect(b!.tags).not.toContain('diwali-offer')
  })

  it('exports what the filters show as CSV, for owners and admins only, safe to open in Excel', async () => {
    await t.db
      .insert(contacts)
      .values({ orgId: t.orgA.org.id, waId: '919811100020', name: '=HYPERLINK("x")' })
    const staff = await t.login(t.users.staff)
    expect((await staff.get(api('/contacts/export'))).status).toBe(403)
    const owner = await t.login(t.users.owner)
    const res = await owner.get(api('/contacts/export'))
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/csv')
    expect(res.text).toContain('+919811100001')
    expect(res.text).toContain(`"'=HYPERLINK(""x"")"`)
    // One row per contact of this org, none of the other org's.
    const mineCount = await t.db.$count(contacts, eq(contacts.orgId, t.orgA.org.id))
    expect(res.text.trim().split('\n')).toHaveLength(mineCount + 1)
    expect(res.text).not.toContain(t.orgB.contact.name ?? 'Contact 9198222')
  })
})

describe('saved segments', () => {
  it('save, list with a live count, rename, delete; agents cannot', async () => {
    const staff = await t.login(t.users.staff)
    expect((await staff.get(api('/segments'))).status).toBe(403)

    const owner = await t.login(t.users.owner)
    const made = await owner
      .post(api('/segments'))
      .send({ name: 'Old register', filters: { tags: ['old-register'] } })
    expect(made.status).toBe(201)
    // Two people carry the tag; neither has said yes, so a campaign reaches nobody yet.
    expect(made.body).toMatchObject({ name: 'Old register', count: 0, noConsent: 2 })

    const again = await owner.post(api('/segments')).send({ name: 'Old register', filters: {} })
    expect(again.status).toBe(400)
    expect(again.body.error.details).toMatchObject({ reason: 'name_taken' })

    const list = await owner.get(api('/segments'))
    expect(list.body.segments).toHaveLength(1)

    const renamed = await owner.patch(api(`/segments/${made.body.id}`)).send({ name: 'Register' })
    expect(renamed.body.name).toBe('Register')
    expect((await owner.delete(api(`/segments/${made.body.id}`))).status).toBe(200)
    expect(await t.db.$count(segments, eq(segments.orgId, t.orgA.org.id))).toBe(0)
  })

  it("another org's segment can't be read, changed or deleted", async () => {
    const [theirs] = await t.db
      .insert(segments)
      .values({ orgId: t.orgB.org.id, name: 'Theirs', filters: {} })
      .returning()
    const owner = await t.login(t.users.owner)
    expect((await owner.patch(api(`/segments/${theirs!.id}`)).send({ name: 'x' })).status).toBe(404)
    expect((await owner.delete(api(`/segments/${theirs!.id}`))).status).toBe(404)
    const list = await owner.get(api('/segments'))
    expect(list.body.segments.map((s: { id: string }) => s.id)).not.toContain(theirs!.id)
    expect(await t.db.$count(segments, eq(segments.id, theirs!.id))).toBe(1)
  })
})
