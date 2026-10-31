import { ArrowSquareOutIcon, PhoneIcon } from '@phosphor-icons/react'
import type { TemplateButton } from '@haazir/shared'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'

/**
 * A template as it lands on the phone (spec §16.9 "live WhatsApp-style
 * preview"): header, body, footer and buttons in one received bubble.
 */
export function WhatsAppPreview({
  header,
  body,
  footer,
  buttons,
  className,
}: {
  header?: string | null
  body: string
  footer?: string | null
  buttons?: TemplateButton[]
  className?: string
}) {
  const { t } = useTranslation()
  return (
    <figure
      className={cn('rounded-card border border-rule bg-paper p-3', className)}
      aria-label={t('templates.preview')}
    >
      <figcaption className="mb-2 text-small text-ink-muted">{t('templates.preview')}</figcaption>
      <div className="max-w-[320px] rounded-card rounded-tl-[4px] border border-rule bg-surface text-body text-ink">
        <div className="px-3.5 pt-2 pb-2">
          {header && <p className="mb-1 font-semibold break-words">{header}</p>}
          <p className="break-words whitespace-pre-wrap">
            {body.trim() || <span className="text-ink-muted">{t('templates.previewEmpty')}</span>}
          </p>
          {footer && <p className="mt-1 text-small text-ink-muted">{footer}</p>}
        </div>
        {buttons?.map((b, i) => (
          <p
            key={i}
            className="flex min-h-10 items-center justify-center gap-1.5 border-t border-rule px-3 text-small font-semibold text-pottery-600"
          >
            {b.type === 'URL' && <ArrowSquareOutIcon className="size-4" aria-hidden />}
            {b.type === 'PHONE_NUMBER' && <PhoneIcon className="size-4" aria-hidden />}
            {b.text || '…'}
          </p>
        ))}
      </div>
    </figure>
  )
}
