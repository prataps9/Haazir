import { describe, expect, it } from 'vitest'
import { parseCsv, rowsFromCsv } from '@/lib/contacts'

describe('reading a contacts CSV', () => {
  it('handles quotes, commas inside cells, both line endings, blank lines and Excel’s BOM', () => {
    const table = parseCsv(
      '\uFEFFName,Phone\r\n"Sharma, Sunita",98111 00001\n\n"He said ""hi""",9811100002\n',
    )
    expect(table).toEqual([
      ['Name', 'Phone'],
      ['Sharma, Sunita', '98111 00001'],
      ['He said "hi"', '9811100002'],
    ])
  })

  it('finds the columns by their headings, in English or Hindi, in any order', () => {
    const { rows, hasConsentColumn } = rowsFromCsv(
      parseCsv(
        'नाम,Mobile No.,Tags,Consent\nSunita,9811100001,neet; parent,Yes\nRavi,9811100002,,no\n',
      ),
    )
    expect(hasConsentColumn).toBe(true)
    expect(rows).toEqual([
      { phone: '9811100001', name: 'Sunita', tags: ['neet', 'parent'], consent: true },
      { phone: '9811100002', name: 'Ravi', tags: undefined, consent: false },
    ])
  })

  it('without a heading row, takes the first column as the number and the second as the name', () => {
    const { rows, hasConsentColumn } = rowsFromCsv(parseCsv('9811100001,Sunita\n9811100002\n'))
    expect(hasConsentColumn).toBe(false)
    expect(rows).toEqual([
      { phone: '9811100001', name: 'Sunita', tags: undefined, consent: undefined },
      { phone: '9811100002', name: undefined, tags: undefined, consent: undefined },
    ])
  })

  it('a file with no consent column never marks anyone as agreed', () => {
    const { rows } = rowsFromCsv(parseCsv('phone,name\n9811100001,Yes\n'))
    expect(rows[0]!.consent).toBeUndefined()
  })
})
