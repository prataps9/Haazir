import { describe, expect, it } from 'vitest'
import { addDays, daysBetween, feeStatusOn, planTotal, scheduleInstallments } from '../fees'

describe('fee schedule', () => {
  it('spreads a plan over dates from the admission day, across month ends', () => {
    expect(
      scheduleInstallments(
        [
          { label: 'Pehli kisht', amountPaise: 6_000_00, dueOffsetDays: 0 },
          { label: 'Doosri kisht', amountPaise: 6_000_00, dueOffsetDays: 60 },
        ],
        '2026-12-15',
      ),
    ).toEqual([
      { label: 'Pehli kisht', amountPaise: 6_000_00, dueDate: '2026-12-15' },
      { label: 'Doosri kisht', amountPaise: 6_000_00, dueDate: '2027-02-13' },
    ])
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(daysBetween('2026-10-21', '2026-10-18')).toBe(-3)
  })

  it('upcoming before the due date, due on it, overdue after; paid stays paid', () => {
    const due = (status: 'upcoming' | 'paid' = 'upcoming') => ({ dueDate: '2026-10-21', status })
    expect(feeStatusOn(due(), '2026-10-20')).toBe('upcoming')
    expect(feeStatusOn(due(), '2026-10-21')).toBe('due')
    expect(feeStatusOn(due(), '2026-10-22')).toBe('overdue')
    expect(feeStatusOn(due('paid'), '2026-11-30')).toBe('paid')
  })

  it('adds up a plan', () => {
    expect(
      planTotal([
        { label: 'a', amountPaise: 100, dueOffsetDays: 0 },
        { label: 'b', amountPaise: 250, dueOffsetDays: 9 },
      ]),
    ).toBe(350)
  })
})
