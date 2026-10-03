import { ChatsCircleIcon, MagnifyingGlassIcon } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Avatar } from '@/components/Avatar'
import { Button } from '@/components/Button'
import { EmptyState } from '@/components/EmptyState'
import { ListSkeleton } from '@/components/Skeleton'
import { StatusPill } from '@/components/StatusPill'
import { cn } from '@/lib/cn'
import { usePreferences } from '@/lib/preferences'
import { listTime } from '@/lib/time'
import { displayName, type ConversationSummary } from '@/lib/types'
import { useConversations, type Filter } from './queries'

/** Spec §16.4 list: search, filter chips, rows with arch avatar, preview, time, mode pill, unread. */
export function ConversationList({ orgId, activeId }: { orgId: string; activeId?: string }) {
  const { t } = useTranslation()
  const [filter, setFilter] = useState<Filter>('all')
  const [input, setInput] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => {
    const id = setTimeout(() => setQ(input.trim()), 300)
    return () => clearTimeout(id)
  }, [input])

  const query = useConversations(orgId, filter, q)
  const items = query.data?.pages.flatMap((p) => p.conversations) ?? []

  // Load more when the last row scrolls into view (infinite scroll, spec §16).
  const sentinel = useRef<HTMLLIElement>(null)
  useEffect(() => {
    const el = sentinel.current
    if (!el || !query.hasNextPage) return
    const io = new IntersectionObserver(
      ([e]) => e?.isIntersecting && !query.isFetchingNextPage && void query.fetchNextPage(),
    )
    io.observe(el)
    return () => io.disconnect()
  }, [query, items.length])

  const chips: { value: Filter; label: string }[] = [
    { value: 'all', label: t('chat.all') },
    { value: 'human', label: t('chat.needsMe') },
    { value: 'unread', label: t('chat.unread') },
  ]

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-3 border-b border-rule p-3">
        <label className="relative block">
          <span className="sr-only">{t('chat.search')}</span>
          <MagnifyingGlassIcon
            className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-ink-muted"
            aria-hidden
          />
          <input
            type="search"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t('chat.search')}
            className="h-11 w-full rounded-control border border-rule bg-surface pr-3 pl-10 text-body text-ink placeholder:text-ink-muted/80 focus-visible:border-focus"
          />
        </label>
        <div
          role="radiogroup"
          aria-label={t('chat.filters')}
          className="flex gap-2 overflow-x-auto"
        >
          {chips.map((c) => (
            <button
              key={c.value}
              type="button"
              role="radio"
              aria-checked={filter === c.value}
              onClick={() => setFilter(c.value)}
              className={cn(
                'h-9 shrink-0 rounded-full border px-3.5 text-small font-semibold transition-colors duration-150',
                filter === c.value
                  ? 'border-madder-700 bg-madder-50 text-madder-700'
                  : 'border-rule text-ink-muted hover:text-ink',
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {query.isPending ? (
          <ListSkeleton />
        ) : query.isError ? (
          <div className="p-6 text-center">
            <p className="text-body text-ink-muted">{t('common.loadError')}</p>
            <Button
              variant="secondary"
              size="md"
              className="mt-3"
              onClick={() => void query.refetch()}
            >
              {t('common.retry')}
            </Button>
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={ChatsCircleIcon}
            title={filter === 'all' && !q ? t('chat.emptyTitle') : t('chat.emptyFilterTitle')}
            body={filter === 'all' && !q ? t('chat.emptyBody') : t('chat.emptyFilterBody')}
          />
        ) : (
          <ul>
            {items.map((c) => (
              <li key={c.id}>
                <Row conversation={c} active={c.id === activeId} />
              </li>
            ))}
            <li ref={sentinel} aria-hidden className="h-1" />
          </ul>
        )}
      </div>
    </div>
  )
}

function Row({ conversation: c, active }: { conversation: ConversationSummary; active: boolean }) {
  const { t } = useTranslation()
  const lang = usePreferences((s) => s.language)
  const name = displayName(c.contact)
  return (
    <Link
      to={`/chat/${c.id}`}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex items-center gap-3 border-b border-rule px-4 py-3 transition-colors duration-150',
        active ? 'bg-madder-50' : 'hover:bg-ink/5',
      )}
    >
      {active && <span className="absolute inset-y-0 left-0 w-1 bg-madder-700" aria-hidden />}
      <Avatar name={name} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className={cn('truncate text-body text-ink', c.unreadCount > 0 && 'font-semibold')}>
            {name}
          </p>
          <time
            className={cn(
              'shrink-0 text-small',
              c.unreadCount > 0 ? 'font-semibold text-pottery-600' : 'text-ink-muted',
            )}
            dateTime={c.lastMessageAt ?? undefined}
          >
            {listTime(c.lastMessageAt, lang)}
          </time>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p className="truncate text-small text-ink-muted">{c.lastMessagePreview}</p>
          <div className="flex shrink-0 items-center gap-1.5">
            <StatusPill tone={c.mode === 'human' ? 'human' : 'bot'} className="h-6 text-small">
              {c.mode === 'human' ? t('sample.you') : t('chat.botTag')}
            </StatusPill>
            {c.unreadCount > 0 && (
              <span
                className="flex h-6 min-w-6 items-center justify-center rounded-full bg-pottery-600 px-1.5 text-small font-semibold text-paper tabular"
                aria-label={`${c.unreadCount} ${t('chat.unread')}`}
              >
                {c.unreadCount}
              </span>
            )}
          </div>
        </div>
      </div>
    </Link>
  )
}
