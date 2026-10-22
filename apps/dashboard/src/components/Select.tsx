import { CaretDownIcon } from '@phosphor-icons/react'
import { useId, type ComponentProps } from 'react'
import { cn } from '@/lib/cn'

interface SelectProps extends ComponentProps<'select'> {
  /** Always visible; `hideLabel` keeps it for screen readers only (filters in a toolbar). */
  label: string
  hideLabel?: boolean
  hint?: string
}

/** A native select: the phone's own picker, keyboard and screen readers for free. 48px tall. */
export function Select({ label, hideLabel, hint, className, id, children, ...props }: SelectProps) {
  const autoId = useId()
  const selectId = id ?? autoId
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label
        htmlFor={selectId}
        className={cn('text-small font-semibold text-ink', hideLabel && 'sr-only')}
      >
        {label}
      </label>
      <div className="relative">
        <select
          id={selectId}
          aria-describedby={hint ? `${selectId}-hint` : undefined}
          className="h-12 w-full appearance-none rounded-control border border-rule bg-surface pr-10 pl-3.5 text-body text-ink transition-colors duration-150 hover:border-ink-muted/60 focus-visible:border-focus focus-visible:outline-2 focus-visible:outline-offset-0 disabled:opacity-60"
          {...props}
        >
          {children}
        </select>
        <CaretDownIcon
          className="pointer-events-none absolute top-1/2 right-3 size-5 -translate-y-1/2 text-ink-muted"
          aria-hidden
        />
      </div>
      {hint && (
        <p id={`${selectId}-hint`} className="text-small text-ink-muted">
          {hint}
        </p>
      )}
    </div>
  )
}
