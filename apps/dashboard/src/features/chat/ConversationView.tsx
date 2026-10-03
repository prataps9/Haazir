import {
  ArrowLeftIcon,
  IdentificationCardIcon,
  PaperPlaneRightIcon,
  SpinnerIcon,
  UserSwitchIcon,
  WarningIcon,
} from '@phosphor-icons/react'
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Avatar } from '@/components/Avatar'
import { Button, IconButton } from '@/components/Button'
import { ChatBubble, DaySeparator } from '@/components/ChatBubble'
import { Skeleton } from '@/components/Skeleton'
import { StatusPill } from '@/components/StatusPill'
import { WindowTimer } from '@/components/WindowTimer'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/cn'
import { usePreferences } from '@/lib/preferences'
import { dayLabel, sameDay, windowLeft } from '@/lib/time'
import { toast } from '@/lib/toast'
import { displayName, formatPhone, type ConversationSummary, type Message } from '@/lib/types'
import { useConversation, useMarkRead, useMessages, useModeChange, useSendMessage } from './queries'

export function ConversationView({ id, onShowContact }: { id: string; onShowContact(): void }) {
  const { t } = useTranslation()
  const conversation = useConversation(id)
  const c = conversation.data

  if (!c) {
    return (
      <div className="flex h-full flex-col" aria-busy="true">
        <div className="flex h-16 items-center gap-3 border-b border-rule px-4">
          <Skeleton className="h-12 w-9" />
          <Skeleton className="h-5 w-40" />
        </div>
        <div className="flex-1" />
        {conversation.isError && (
          <p className="p-6 text-center text-body text-ink-muted">{t('common.loadError')}</p>
        )}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      <Header conversation={c} onShowContact={onShowContact} />
      <ModeStrip conversation={c} />
      {c.mode === 'human' && c.handoffSummary && <HandoffBanner conversation={c} />}
      <MessageList conversationId={id} />
      <Footer conversation={c} />
    </div>
  )
}

function Header({
  conversation: c,
  onShowContact,
}: {
  conversation: ConversationSummary
  onShowContact(): void
}) {
  const { t } = useTranslation()
  const name = displayName(c.contact)
  return (
    <header className="flex h-16 shrink-0 items-center gap-2 border-b border-rule bg-surface pr-2 pl-1 lg:pl-4">
      <Link
        to="/chat"
        aria-label={t('chat.back')}
        className="flex size-11 items-center justify-center rounded-control text-ink hover:bg-ink/5 lg:hidden"
      >
        <ArrowLeftIcon className="size-6" aria-hidden />
      </Link>
      <Avatar name={name} size="sm" />
      <div className="min-w-0 flex-1">
        <h1 className="truncate font-sans text-h3 text-ink">{name}</h1>
        <p className="truncate text-small text-ink-muted">
          {formatPhone(c.contact.waId)}
          {c.contact.language
            ? `, ${t(`contact.languages.${c.contact.language}`, { defaultValue: c.contact.language })}`
            : ''}
        </p>
      </div>
      <IconButton label={t('chat.contactDetails')} onClick={onShowContact} className="xl:hidden">
        <IdentificationCardIcon />
      </IconButton>
    </header>
  )
}

/** "Bot chala raha hai" ⇄ "Aap sambhal rahe hain": the takeover switch (colour swap, 150ms). */
function ModeStrip({ conversation: c }: { conversation: ConversationSummary }) {
  const { t } = useTranslation()
  const change = useModeChange(c.id)
  const human = c.mode === 'human'
  const flip = () =>
    change.mutate(human ? 'bot' : 'human', {
      onSuccess: () =>
        toast({
          title: human ? t('chat.handedBack') : t('chat.takenOver'),
          tone: human ? 'success' : 'human',
        }),
      onError: () => toast({ title: t('common.loadError'), tone: 'danger' }),
    })
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-between gap-3 border-b border-rule px-4 py-2 transition-colors duration-150',
        human ? 'bg-madder-50' : 'bg-pottery-50',
      )}
    >
      <StatusPill tone={human ? 'human' : 'bot'} className="bg-transparent px-0">
        {human ? t('chat.modeHuman') : t('chat.modeBot')}
      </StatusPill>
      <Button
        size="md"
        variant={human ? 'secondary' : 'primary'}
        onClick={flip}
        loading={change.isPending}
      >
        <UserSwitchIcon aria-hidden />
        {human ? t('chat.handback') : t('chat.takeover')}
      </Button>
    </div>
  )
}

function HandoffBanner({ conversation: c }: { conversation: ConversationSummary }) {
  const { t } = useTranslation()
  return (
    <div role="note" className="flex shrink-0 gap-3 border-b border-rule bg-surface px-4 py-3">
      <span className="w-1 shrink-0 rounded-full bg-madder-700" aria-hidden />
      <div className="min-w-0">
        <p className="text-small font-semibold text-madder-700">
          {t('chat.handoffBanner')}
          {c.handoffReason
            ? `: ${t(`chat.reasons.${c.handoffReason}`, { defaultValue: c.handoffReason })}`
            : ''}
        </p>
        <p className="text-body text-ink">{c.handoffSummary}</p>
      </div>
    </div>
  )
}

function MessageList({ conversationId }: { conversationId: string }) {
  const { t } = useTranslation()
  const lang = usePreferences((s) => s.language)
  const query = useMessages(conversationId)
  const markRead = useMarkRead(conversationId)
  const send = useSendMessage(conversationId)
  const scroller = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)

  // Pages are newest-first; within a page oldest-first. Flatten to one oldest-first list.
  const items: Message[] = [...(query.data?.pages ?? [])].reverse().flatMap((p) => p.messages)
  const last = items.at(-1)

  // Stick to the bottom when new messages arrive, unless the person scrolled up to read.
  useLayoutEffect(() => {
    const el = scroller.current
    if (el && atBottom.current) el.scrollTop = el.scrollHeight
  }, [last?.id, items.length])

  // Opening the chat, or a new inbound message while it's open, marks it read.
  useEffect(() => {
    if (last?.direction === 'in') markRead.mutate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, last?.id])

  const onScroll = () => {
    const el = scroller.current
    if (el) atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  return (
    <div
      ref={scroller}
      onScroll={onScroll}
      className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-6"
      aria-live="polite"
      aria-relevant="additions"
    >
      {query.hasNextPage && (
        <div className="mb-2 flex justify-center">
          <Button
            variant="ghost"
            size="md"
            onClick={() => void query.fetchNextPage()}
            loading={query.isFetchingNextPage}
          >
            {t('chat.loadOlder')}
          </Button>
        </div>
      )}
      {query.isPending && (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-14 w-3/5" />
          <Skeleton className="ml-auto h-20 w-2/3" />
          <Skeleton className="h-10 w-1/2" />
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        {items.map((m, i) => (
          <Fragment key={m.id}>
            {(i === 0 || !sameDay(items[i - 1]!.createdAt, m.createdAt)) && (
              <DaySeparator label={dayLabel(m.createdAt, lang)} />
            )}
            <ChatBubble message={m} onRetry={(msg) => msg.body && send.mutate(msg.body)} />
          </Fragment>
        ))}
      </div>
    </div>
  )
}

function Footer({ conversation: c }: { conversation: ConversationSummary }) {
  const { t } = useTranslation()
  if (c.contact.optInStatus === 'opted_out') {
    return (
      <div className="flex shrink-0 items-start gap-2 border-t border-rule bg-surface px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] text-body text-ink">
        <WarningIcon className="mt-1 size-5 shrink-0 text-danger-600" weight="bold" aria-hidden />
        {t('chat.optedOut')}
      </div>
    )
  }
  const open = windowLeft(c.serviceWindowExpiresAt) !== null
  return (
    <div className="shrink-0 border-t border-rule bg-surface px-3 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] sm:px-4">
      <WindowTimer expiresAt={c.serviceWindowExpiresAt} className="mb-2" />
      {open ? (
        <Composer conversationId={c.id} />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
          <p className="text-small text-ink-muted">{t('chat.windowClosedBody')}</p>
          {/* Templates arrive in Phase 5; the button is here so the flow is visible. */}
          <Button size="md" variant="secondary" disabled title={t('chat.templatesSoon')}>
            {t('chat.sendTemplate')}
          </Button>
        </div>
      )}
    </div>
  )
}

function Composer({ conversationId }: { conversationId: string }) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const send = useSendMessage(conversationId)
  const area = useRef<HTMLTextAreaElement>(null)

  // Grow with the text, up to about five lines.
  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`
  }, [text])

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    const body = text.trim()
    if (!body) return
    setText('')
    send.mutate(body, {
      onError: (err) => {
        setText(body)
        const code = err instanceof ApiError ? err.code : ''
        toast({
          title: t(`chat.errors.${code}`, { defaultValue: t('chat.errors.generic') }),
          tone: 'danger',
        })
      },
    })
  }

  // Enter sends on a keyboard; on phones Enter is a new line and the button sends.
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(pointer: fine)').matches) submit(e)
  }

  return (
    <form onSubmit={submit} className="flex items-end gap-2">
      <label className="min-w-0 flex-1">
        <span className="sr-only">{t('chat.composer')}</span>
        <textarea
          ref={area}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          placeholder={t('chat.composer')}
          maxLength={4096}
          className="block max-h-36 min-h-11 w-full resize-none rounded-control border border-rule bg-paper px-3.5 py-2.5 text-body text-ink placeholder:text-ink-muted/80 focus-visible:border-focus"
        />
      </label>
      <button
        type="submit"
        disabled={!text.trim()}
        aria-label={t('chat.send')}
        className="flex size-11 shrink-0 items-center justify-center rounded-control bg-madder-700 text-paper transition-colors duration-150 hover:bg-madder-600 disabled:opacity-40"
      >
        {send.isPending ? (
          <SpinnerIcon className="size-5 animate-spin motion-reduce:animate-none" aria-hidden />
        ) : (
          <PaperPlaneRightIcon className="size-5" weight="fill" aria-hidden />
        )}
      </button>
    </form>
  )
}
