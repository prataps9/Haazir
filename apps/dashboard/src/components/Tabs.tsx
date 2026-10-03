import { useId, useRef, type KeyboardEvent } from 'react'
import { cn } from '@/lib/cn'

interface TabsProps<T extends string> {
  label: string
  value: T
  tabs: { value: T; label: string; count?: number }[]
  onChange(value: T): void
  className?: string
}

/** WAI-ARIA tabs: arrow keys move between them. Scrolls sideways on narrow phones. */
export function Tabs<T extends string>({ label, value, tabs, onChange, className }: TabsProps<T>) {
  const id = useId()
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const onKey = (e: KeyboardEvent, i: number) => {
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!delta) return
    const next = (i + delta + tabs.length) % tabs.length
    refs.current[next]?.focus()
    onChange(tabs[next]!.value)
  }
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn(
        '-mx-4 flex gap-1 overflow-x-auto border-b border-rule px-4 sm:mx-0 sm:px-0',
        className,
      )}
    >
      {tabs.map((tab, i) => {
        const selected = tab.value === value
        return (
          <button
            key={tab.value}
            ref={(el) => void (refs.current[i] = el)}
            id={`${id}-${tab.value}`}
            role="tab"
            type="button"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.value)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              'relative flex h-11 shrink-0 items-center gap-2 px-3 text-body whitespace-nowrap transition-colors duration-150',
              selected ? 'font-semibold text-madder-700' : 'text-ink-muted hover:text-ink',
            )}
          >
            {tab.label}
            {tab.count ? (
              <span className="rounded-full bg-madder-50 px-2 text-small text-madder-700 tabular">
                {tab.count}
              </span>
            ) : null}
            {selected && (
              <span
                className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-madder-700"
                aria-hidden
              />
            )}
          </button>
        )
      })}
    </div>
  )
}
