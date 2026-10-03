import * as Dialog from '@radix-ui/react-dialog'
import { Button } from './Button'

interface ConfirmDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
  title: string
  body?: string
  confirmLabel: string
  cancelLabel: string
  /** Red confirm button for things that can't be undone (delete, bot off). */
  danger?: boolean
  loading?: boolean
  onConfirm(): void
}

/** Asks once before something that's hard to take back. Radix handles focus and Escape. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  cancelLabel,
  danger,
  loading,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 animate-fade-in bg-[rgb(18_22_42/0.45)]" />
        <Dialog.Content
          {...(body ? {} : { 'aria-describedby': undefined })}
          className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-card bg-surface p-5 shadow-float focus:outline-none"
        >
          <Dialog.Title className="text-h3 text-ink">{title}</Dialog.Title>
          {body && (
            <Dialog.Description className="mt-2 text-body text-ink-muted">
              {body}
            </Dialog.Description>
          )}
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Dialog.Close asChild>
              <Button variant="ghost" size="md">
                {cancelLabel}
              </Button>
            </Dialog.Close>
            <Button
              variant={danger ? 'danger' : 'primary'}
              size="md"
              loading={loading}
              onClick={onConfirm}
            >
              {confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
