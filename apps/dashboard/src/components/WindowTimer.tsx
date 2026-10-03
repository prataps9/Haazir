import { HourglassMediumIcon } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'
import { windowLeft } from '@/lib/time'

/**
 * WhatsApp's 24-hour free reply window (spec §16.4): "Free reply window: 18
 * ghante baaki". Updates every minute; turns marigold in the last hour.
 */
export function WindowTimer({
  expiresAt,
  className,
}: {
  expiresAt: string | null
  className?: string
}) {
  const { t } = useTranslation()
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])
  const left = windowLeft(expiresAt, now)
  const urgent = !left || 'minutes' in left
  return (
    <p
      className={cn(
        'flex items-center gap-1.5 text-small',
        urgent ? 'text-ink' : 'text-ink-muted',
        className,
      )}
    >
      <HourglassMediumIcon
        className={cn('size-4', urgent ? 'text-marigold-500' : '')}
        weight="bold"
        aria-hidden
      />
      {!left
        ? t('chat.windowClosed')
        : 'hours' in left
          ? t('chat.windowHours', { count: left.hours })
          : t('chat.windowMinutes', { count: left.minutes })}
    </p>
  )
}
