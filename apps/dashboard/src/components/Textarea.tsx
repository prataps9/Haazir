import { useId, type ComponentProps } from 'react'
import { cn } from '@/lib/cn'

interface TextareaProps extends ComponentProps<'textarea'> {
  label: string
  hint?: string
  error?: string
  /** Show "12/20" under the field (WhatsApp limits). */
  maxChars?: number
  hideLabel?: boolean
}

export function Textarea({
  label,
  hint,
  error,
  maxChars,
  hideLabel,
  className,
  id,
  value,
  ...props
}: TextareaProps) {
  const autoId = useId()
  const fieldId = id ?? autoId
  const noteId = `${fieldId}-note`
  const length = typeof value === 'string' ? [...value].length : 0
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label
        htmlFor={fieldId}
        className={cn('text-small font-semibold text-ink', hideLabel && 'sr-only')}
      >
        {label}
      </label>
      <textarea
        id={fieldId}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? noteId : undefined}
        className={cn(
          'min-h-24 w-full resize-y rounded-control border bg-surface px-3.5 py-3 text-body text-ink placeholder:text-ink-muted/80',
          'focus-visible:border-focus focus-visible:outline-2 focus-visible:outline-offset-0',
          error ? 'border-danger-600' : 'border-rule',
        )}
        {...props}
      />
      <div className="flex justify-between gap-2 text-small">
        {(error || hint) && (
          <p id={noteId} className={error ? 'text-danger-600' : 'text-ink-muted'}>
            {error ?? hint}
          </p>
        )}
        {maxChars && (
          <p
            className={cn(
              'ml-auto tabular',
              length > maxChars ? 'text-danger-600' : 'text-ink-muted',
            )}
          >
            {length}/{maxChars}
          </p>
        )}
      </div>
    </div>
  )
}
