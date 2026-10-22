import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { GraphClient, GraphError } from '../client'

const BASE = 'https://graph.test'
const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const client = new GraphClient({
  baseUrl: BASE,
  version: 'v26.0',
  accessToken: 'test-token',
  phoneNumberId: '1065',
})

describe('GraphClient.send', () => {
  it('posts to the pinned version with the token, and returns the wamid', async () => {
    let seen: { auth: string | null; body: unknown } | undefined
    server.use(
      http.post(`${BASE}/v26.0/1065/messages`, async ({ request }) => {
        seen = { auth: request.headers.get('authorization'), body: await request.json() }
        return HttpResponse.json({
          messaging_product: 'whatsapp',
          contacts: [{ input: '919812345678', wa_id: '919812345678' }],
          messages: [{ id: 'wamid.OUT1' }],
        })
      }),
    )
    const id = await client.send('919812345678', { kind: 'text', body: 'Namaste!' })
    expect(id).toBe('wamid.OUT1')
    expect(seen?.auth).toBe('Bearer test-token')
    expect(seen?.body).toMatchObject({ to: '919812345678', type: 'text' })
  })

  it('marks policy errors as not retryable', async () => {
    server.use(
      http.post(`${BASE}/v26.0/1065/messages`, () =>
        HttpResponse.json(
          {
            error: {
              message: '(#131047) Re-engagement message',
              code: 131047,
              error_data: { details: 'More than 24 hours have passed' },
              fbtrace_id: 'Az8or2yhqkZfEZ-_4Qn_Bam',
            },
          },
          { status: 400 },
        ),
      ),
    )
    const error = await client.send('9198', { kind: 'text', body: 'x' }).catch((e) => e)
    expect(error).toBeInstanceOf(GraphError)
    expect(error.code).toBe(131047)
    expect(error.details).toBe('More than 24 hours have passed')
    expect(error.retryable).toBe(false)
  })

  it('marks Meta outages and throttling as retryable', async () => {
    server.use(
      http.post(`${BASE}/v26.0/1065/messages`, () => new HttpResponse(null, { status: 503 })),
    )
    expect((await client.send('9198', { kind: 'text', body: 'x' }).catch((e) => e)).retryable).toBe(
      true,
    )

    server.use(
      http.post(`${BASE}/v26.0/1065/messages`, () =>
        HttpResponse.json({ error: { code: 130429, message: 'Rate limit hit' } }, { status: 400 }),
      ),
    )
    expect((await client.send('9198', { kind: 'text', body: 'x' }).catch((e) => e)).retryable).toBe(
      true,
    )
  })

  it('recognises an expired token', async () => {
    server.use(
      http.post(`${BASE}/v26.0/1065/messages`, () =>
        HttpResponse.json(
          { error: { code: 190, message: 'Session has expired' } },
          { status: 401 },
        ),
      ),
    )
    const error = await client.send('9198', { kind: 'text', body: 'x' }).catch((e) => e)
    expect(error.isAuthError).toBe(true)
    expect(error.retryable).toBe(false)
  })

  it('treats a network failure as retryable', async () => {
    server.use(http.post(`${BASE}/v26.0/1065/messages`, () => HttpResponse.error()))
    const error = await client.send('9198', { kind: 'text', body: 'x' }).catch((e) => e)
    expect(error).toBeInstanceOf(GraphError)
    expect(error.retryable).toBe(true)
  })
})

describe('GraphClient.markRead', () => {
  it('can show the typing indicator along with the read receipt', async () => {
    let body: unknown
    server.use(
      http.post(`${BASE}/v26.0/1065/messages`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ success: true })
      }),
    )
    await client.markRead('wamid.IN1', { typing: true })
    expect(body).toEqual({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: 'wamid.IN1',
      typing_indicator: { type: 'text' },
    })
  })
})

describe('media', () => {
  it('looks up the media URL, then downloads it with the same token', async () => {
    server.use(
      http.get(`${BASE}/v26.0/998877`, () =>
        HttpResponse.json({
          url: 'https://lookaside.test/media/998877',
          mime_type: 'image/jpeg',
          sha256: 'abc',
          file_size: '5',
          id: '998877',
          messaging_product: 'whatsapp',
        }),
      ),
      http.get('https://lookaside.test/media/998877', ({ request }) =>
        request.headers.get('authorization') === 'Bearer test-token'
          ? new HttpResponse('hello', { headers: { 'content-type': 'image/jpeg' } })
          : new HttpResponse(null, { status: 401 }),
      ),
    )
    const info = await client.getMedia('998877')
    expect(info).toEqual({
      url: 'https://lookaside.test/media/998877',
      mimeType: 'image/jpeg',
      fileSize: 5,
      sha256: 'abc',
    })
    expect(await (await client.downloadMedia(info.url)).text()).toBe('hello')
  })
})

describe('GraphClient.uploadMedia', () => {
  it('uploads a brochure as multipart and returns the media id', async () => {
    let seen: { type: string | null; product: unknown; file?: File } | undefined
    server.use(
      http.post(`${BASE}/v26.0/1065/media`, async ({ request }) => {
        const form = await request.formData()
        seen = {
          type: request.headers.get('content-type'),
          product: form.get('messaging_product'),
          file: form.get('file') as File,
        }
        return HttpResponse.json({ id: 'media-123' })
      }),
    )
    const id = await client.uploadMedia(Buffer.from('%PDF-1.4'), 'application/pdf', 'rscit.pdf')
    expect(id).toBe('media-123')
    expect(seen?.type).toMatch(/^multipart\/form-data; boundary=/)
    expect(seen?.product).toBe('whatsapp')
    expect(seen?.file?.name).toBe('rscit.pdf')
  })

  it('refuses to send a stored file that was never uploaded', async () => {
    await expect(
      client.send('9198', { kind: 'document', storageKey: 'orgs/x/brochure.pdf' }),
    ).rejects.toThrow('Upload the file first')
  })
})

describe('GraphClient templates', () => {
  it('submits with Meta’s upper-case category and returns the id and status', async () => {
    let body: unknown
    server.use(
      http.post(`${BASE}/v26.0/2001/message_templates`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ id: '1689', status: 'PENDING', category: 'UTILITY' })
      }),
    )
    const created = await client.createTemplate('2001', {
      name: 'fee_due',
      language: 'hi',
      category: 'utility',
      components: [{ type: 'BODY', text: 'Aaj fees due hai.' }],
    })
    expect(created).toEqual({ id: '1689', status: 'PENDING', category: 'UTILITY' })
    expect(body).toMatchObject({ name: 'fee_due', language: 'hi', category: 'UTILITY' })
  })

  it('follows pages when listing', async () => {
    server.use(
      http.get(`${BASE}/v26.0/2001/message_templates`, ({ request }) => {
        const after = new URL(request.url).searchParams.get('after')
        return HttpResponse.json(
          after
            ? {
                data: [
                  {
                    id: '2',
                    name: 'b',
                    language: 'en',
                    status: 'REJECTED',
                    category: 'MARKETING',
                    rejected_reason: 'PROMOTIONAL',
                  },
                ],
              }
            : {
                data: [
                  {
                    id: '1',
                    name: 'a',
                    language: 'hi',
                    status: 'APPROVED',
                    category: 'UTILITY',
                    rejected_reason: 'NONE',
                  },
                ],
                paging: { cursors: { after: 'c1' }, next: 'https://graph.test/next' },
              },
        )
      }),
    )
    const list = await client.listTemplates('2001')
    expect(list.map((t) => [t.id, t.status, t.rejectedReason])).toEqual([
      ['1', 'APPROVED', undefined],
      ['2', 'REJECTED', 'PROMOTIONAL'],
    ])
  })

  it('deletes by name and id', async () => {
    let url = ''
    server.use(
      http.delete(`${BASE}/v26.0/2001/message_templates`, ({ request }) => {
        url = request.url
        return HttpResponse.json({ success: true })
      }),
    )
    await client.deleteTemplate('2001', 'diwali_offer', '1689')
    expect(new URL(url).searchParams.get('name')).toBe('diwali_offer')
    expect(new URL(url).searchParams.get('hsm_id')).toBe('1689')
  })
})
