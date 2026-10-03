import { CheckCircleIcon, UserIcon, WarningCircleIcon, XIcon } from '@phosphor-icons/react'
import { Link } from 'react-router'
import { cn } from '@/lib/cn'
import { useToasts } from '@/lib/toast'

/** Toasts float above everything (indigo shadow), announced politely to screen readers. */
export function Toaster({ closeLabel }: { closeLabel: string }) {
  const items = useToasts((s) => s.items)
  const dismiss = useToasts((s) => s.dismiss)
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-50 flex flex-col items-center gap-2 px-4 lg:bottom-6 lg:items-end"
    >
      {items.map((t) => {
        const Icon =
          t.tone === 'danger' ? WarningCircleIcon : t.tone === 'human' ? UserIcon : CheckCircleIcon
        const body = (
          <>
            <Icon
              className={cn(
                'mt-0.5 size-5 shrink-0',
                t.tone === 'danger'
                  ? 'text-danger-600'
                  : t.tone === 'human'
                    ? 'text-madder-700'
                    : 'text-pottery-600',
              )}
              weight="fill"
              aria-hidden
            />
            <span className="min-w-0 flex-1">
              <span className="block text-body font-semibold text-ink">{t.title}</span>
              {t.body && <span className="block text-small text-ink-muted">{t.body}</span>}
            </span>
          </>
        )
        return (
          <div
            key={t.id}
            className="pointer-events-auto flex w-full max-w-sm animate-fade-in items-start gap-3 rounded-card border border-rule bg-surface p-3 shadow-float"
          >
            {t.href ? (
              <Link
                to={t.href}
                onClick={() => dismiss(t.id)}
                className="flex min-w-0 flex-1 items-start gap-3"
              >
                {body}
              </Link>
            ) : (
              body
            )}
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label={closeLabel}
              className="-m-1 flex size-8 items-center justify-center rounded-control text-ink-muted hover:bg-ink/5"
            >
              <XIcon className="size-4" aria-hidden />
            </button>
          </div>
        )
      })}
    </div>
  )
}
