import {
  CheckIcon,
  ChecksIcon,
  ClockIcon,
  RobotIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { API_BASE } from '@/lib/api'
import { cn } from '@/lib/cn'
import { usePreferences } from '@/lib/preferences'
import { clock } from '@/lib/time'
import type { Message } from '@/lib/types'

/**
 * One message (spec §14.9, §16.4): inbound on surface, staff replies on
 * madder-50, the bot's on pottery-50 with a small "Bot" tag. Outbound
 * messages show delivery ticks; failures say why and offer a retry.
 */
export function ChatBubble({
  message,
  onRetry,
}: {
  message: Message
  onRetry?(message: Message): void
}) {
  const { t } = useTranslation()
  const lang = usePreferences((s) => s.language)
  const out = message.direction === 'out'
  const bot = out && message.sentBy === 'bot'
  const text = message.body ?? ''
  const buttons = message.interactive?.content?.buttons

  return (
    <div className={cn('flex w-full', out ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-card px-3.5 pt-2 pb-1.5 text-body text-ink lg:max-w-[70%]',
          out ? 'rounded-br-[4px]' : 'rounded-bl-[4px] border border-rule bg-surface',
          out && (bot ? 'bg-pottery-50' : 'bg-madder-50'),
          message.pending && 'opacity-70',
        )}
      >
        {bot && (
          <span className="mb-0.5 flex items-center gap-1 text-small font-semibold text-pottery-600">
            <RobotIcon className="size-4" weight="bold" aria-hidden />
            {t('chat.botTag')}
          </span>
        )}

        <MediaPart message={message} />

        {text && <p className="break-words whitespace-pre-wrap">{text}</p>}

        {buttons && buttons.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5" aria-label={t('chat.buttonsSent')}>
            {buttons.map((b) => (
              <span
                key={b.id}
                className="rounded-full border border-rule bg-surface px-3 py-1 text-small text-ink-muted"
              >
                {b.title}
              </span>
            ))}
          </div>
        )}

        <div className="mt-0.5 flex items-center justify-end gap-1 text-small text-ink-muted">
          <time dateTime={message.createdAt}>{clock(message.createdAt, lang)}</time>
          {out && <Ticks status={message.pending ? 'queued' : message.status} />}
        </div>

        {message.status === 'failed' && (
          <div className="mt-1 flex flex-wrap items-center gap-2 border-t border-danger-600/20 pt-1.5 text-small text-danger-600">
            <WarningCircleIcon className="size-4 shrink-0" weight="bold" aria-hidden />
            <span className="min-w-0 flex-1">
              {t('chat.failed', { reason: message.errorTitle ?? message.errorCode ?? '' })}
            </span>
            {onRetry && text && (
              <button
                type="button"
                onClick={() => onRetry(message)}
                className="min-h-8 rounded-control px-2 font-semibold underline underline-offset-2"
              >
                {t('chat.retry')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function MediaPart({ message }: { message: Message }) {
  const { t } = useTranslation()
  const src = `${API_BASE}/api/v1/media/${message.id}`
  if (message.type === 'image' || message.type === 'sticker') {
    return message.hasMedia ? (
      <img
        src={src}
        alt={message.body ?? t('chat.photo')}
        loading="lazy"
        className="mb-1 max-h-72 w-full rounded-control object-cover"
      />
    ) : (
      <p className="mb-1 text-small text-ink-muted">{t('chat.photoLoading')}</p>
    )
  }
  if (message.type === 'audio') {
    return (
      <div className="mb-1 flex min-w-56 flex-col gap-1">
        {message.hasMedia ? (
          <audio
            controls
            preload="none"
            src={src}
            className="h-10 w-full"
            aria-label={t('chat.voiceNote')}
          />
        ) : (
          <p className="text-small text-ink-muted">{t('chat.voiceNote')}</p>
        )}
        {message.transcript && (
          <details className="text-small">
            <summary className="cursor-pointer text-ink-muted">{t('chat.transcript')}</summary>
            <p className="mt-1 text-body text-ink">{message.transcript}</p>
          </details>
        )}
      </div>
    )
  }
  if (message.type === 'document') {
    return message.hasMedia ? (
      <a
        href={src}
        target="_blank"
        rel="noreferrer"
        className="mb-1 block font-semibold text-madder-700 underline underline-offset-2"
      >
        {t('chat.openDocument')}
      </a>
    ) : null
  }
  return null
}

/** Clock, one tick, two ticks, two blue-pottery ticks: WhatsApp's own vocabulary. */
function Ticks({ status }: { status: Message['status'] }) {
  const { t } = useTranslation()
  if (status === 'failed') return null
  if (status === 'read')
    return (
      <ChecksIcon
        className="size-4 text-pottery-600"
        weight="bold"
        aria-label={t('chat.status.read')}
      />
    )
  if (status === 'delivered')
    return <ChecksIcon className="size-4" weight="bold" aria-label={t('chat.status.delivered')} />
  if (status === 'sent')
    return <CheckIcon className="size-4" weight="bold" aria-label={t('chat.status.sent')} />
  return <ClockIcon className="size-4" aria-label={t('chat.status.queued')} />
}

export function DaySeparator({ label }: { label: string }) {
  return (
    <div className="my-3 flex justify-center" role="separator" aria-label={label}>
      <span className="rounded-full bg-surface px-3 py-0.5 text-small text-ink-muted ring-1 ring-rule">
        {label}
      </span>
    </div>
  )
}
