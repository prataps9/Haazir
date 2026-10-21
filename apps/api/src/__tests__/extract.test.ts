import { MockLanguageModelV4 } from 'ai/test'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Models } from '@haazir/ai-core'
import { createTestApp } from './helpers'

/** The smallest valid PDF with one line of text (same as ai-core's ingest test). */
function tinyPdf(text: string) {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    (() => {
      const stream = `BT /F1 12 Tf 20 100 Td (${text}) Tj ET`
      return `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
    })(),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objs.forEach((o, i) => {
    offsets.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(pdf)
}

const seen: string[] = []
const reading = {
  courses: [
    {
      name: 'Tally Prime with GST and Advanced Accounting',
      shortName: 'Tally Prime with GST and Advanced Accounting',
      fee: '₹8,500/-',
      duration: '3 mahine',
      installments: [
        { label: 'Admission par', amount: 'Rs. 4500', afterDays: 0 },
        { label: 'Ek mahine baad', amount: '4,000', afterDays: 30 },
      ],
    },
  ],
  batches: [{ course: 'Tally', days: ['mon', 'wed'], startTime: '10:00', endTime: '25:99' }],
  address: 'Station Road, Sikar',
}
const fast = new MockLanguageModelV4({
  doGenerate: async (options) => {
    seen.push(JSON.stringify(options.prompt))
    return {
      content: [{ type: 'text', text: JSON.stringify(reading) }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      warnings: [],
    }
  },
})

let t: Awaited<ReturnType<typeof createTestApp>>
beforeAll(async () => {
  t = await createTestApp({
    models: {
      fast,
      smart: fast,
      embedding: null as never,
      ids: { fast: 'f', smart: 's', embedding: 'e' },
    } as Models,
  })
})
afterAll(() => t.close())

describe('brochure auto-extract', () => {
  it('reads an uploaded PDF into a draft of courses with fees in paise, saving nothing', async () => {
    const owner = await t.login(t.users.owner)
    const up = await owner
      .post('/api/v1/knowledge/sources')
      .attach('file', tinyPdf('Tally Prime + GST fees 8500'), {
        filename: 'b.pdf',
        contentType: 'application/pdf',
      })
    expect(up.status).toBe(201)
    const before = (await owner.get('/api/v1/courses')).body.courses.length

    const res = await owner
      .post('/api/v1/knowledge/extract-brochure')
      .send({ sourceId: up.body.id })
    expect(res.status).toBe(200)
    expect(seen.at(-1)).toContain('Tally Prime + GST fees 8500')
    const [course] = res.body.draft.courses
    expect(course).toMatchObject({ feeTotalPaise: 8_500_00, durationText: '3 mahine' })
    expect([...course.shortName].length).toBeLessThanOrEqual(24)
    expect(course.installmentPlan).toEqual([
      { label: 'Admission par', amountPaise: 4_500_00, dueOffsetDays: 0 },
      { label: 'Ek mahine baad', amountPaise: 4_000_00, dueOffsetDays: 30 },
    ])
    // An impossible time from the model is dropped, not saved.
    expect(res.body.draft.batches[0].startTime).toBe('10:00')
    expect(res.body.draft.batches[0].endTime).toBeUndefined()
    expect((await owner.get('/api/v1/courses')).body.courses.length).toBe(before)

    const ownerB = await t.login(t.users.secondOwner)
    expect(
      (await ownerB.post('/api/v1/knowledge/extract-brochure').send({ sourceId: up.body.id }))
        .status,
    ).toBe(404)
  })
})
