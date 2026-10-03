import { useId } from 'react'
import { cn } from '@/lib/cn'

interface SwitchProps {
  checked: boolean
  onChange(checked: boolean): void
  label: string
  /** Shown under the label, e.g. what the switch does right now. */
  description?: string
  disabled?: boolean
  className?: string
}

/** A real checkbox with role="switch": keyboard, screen readers and forms work unaided. */
export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
  className,
}: SwitchProps) {
  const id = useId()
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex min-h-11 cursor-pointer items-center justify-between gap-4',
        disabled && 'cursor-not-allowed opacity-60',
        className,
      )}
    >
      <span className="min-w-0">
        <span className="block text-body font-semibold text-ink">{label}</span>
        {description && <span className="block text-small text-ink-muted">{description}</span>}
      </span>
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        aria-hidden
        className={cn(
          'relative h-7 w-12 shrink-0 rounded-full transition-colors duration-150 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus',
          checked ? 'bg-pottery-600' : 'bg-rule',
        )}
      >
        <span
          className={cn(
            'absolute top-1 left-1 size-5 rounded-full bg-surface transition-transform duration-150',
            checked && 'translate-x-5',
          )}
        />
      </span>
    </label>
  )
}
