import {
  ArrowCounterClockwiseIcon,
  DatabaseIcon,
  FileTextIcon,
  PaperPlaneRightIcon,
  RobotIcon,
  UserIcon,
} from '@phosphor-icons/react'
import { useMutation } from '@tanstack/react-query'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, IconButton } from '@/components/Button'
import { StatusPill } from '@/components/StatusPill'
import { post } from '@/lib/api'
import { cn } from '@/lib/cn'
import { errorText } from '@/lib/errors'

/** What the API's playground returns (apps/api/src/routes/knowledge.ts playgroundView). */
export interface PlaygroundResult {
  kind: 'reply' | 'handoff' | 'optout' | 'silent'
  reply: string | null
  buttons: { id: string; title: string }[]
  handoff: { reason: string; summary: string } | null
  tools: string[]
  guardrailFlags: string[]
  sources: { id: string; content: string }[]
}

interface Turn {
  id: number
  question: string
  result?: PlaygroundResult
  error?: string
}

interface PlaygroundProps {
  /** The knowledge test box and the settings playground keep separate histories. */
  endpoint: 'knowledge' | 'bot'
  aiConfigured: boolean
  suggestions?: string[]
  className?: string
}

/**
 * The real pipeline on a private conversation: nothing goes to WhatsApp. Each
 * answer shows what it was built from, so an owner can see why the bot said it.
 */
export function Playground({
  endpoint,
  aiConfigured,
  suggestions = [],
  className,
}: PlaygroundProps) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const fresh = useRef(true)
  const end = useRef<HTMLDivElement>(null)
  const nextId = useRef(1)

  const ask = useMutation({
    mutationFn: ({ question, reset }: { question: string; reset: boolean }) =>
      endpoint === 'knowledge'
        ? post<PlaygroundResult>('/api/v1/knowledge/test', { question, reset })
        : post<PlaygroundResult>('/api/v1/bot/playground', { text: question, reset }),
  })

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' })
  }, [turns])

  const submit = (question: string, e?: FormEvent) => {
    e?.preventDefault()
    const q = question.trim()
    if (!q || ask.isPending) return
    const id = nextId.current++
    setTurns((all) => [...all, { id, question: q }])
    setText('')
    const reset = fresh.current
    fresh.current = false
    ask.mutate(
      { question: q, reset },
      {
        onSuccess: (result) =>
          setTurns((all) => all.map((x) => (x.id === id ? { ...x, result } : x))),
        onError: (err) =>
          setTurns((all) =>
            all.map((x) => (x.id === id ? { ...x, error: errorText(err, t('common.failed')) } : x)),
          ),
      },
    )
  }

  const restart = () => {
    setTurns([])
    fresh.current = true
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {!aiConfigured && (
        <p className="rounded-card border border-marigold-500/40 bg-marigold-50 px-4 py-3 text-body text-ink">
          {t('knowledge.aiOff')}
        </p>
      )}

      <div
        className="flex min-h-48 flex-col gap-3 rounded-card border border-rule bg-paper p-3"
        aria-live="polite"
      >
        {turns.length === 0 && suggestions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => submit(s)}
                className="min-h-11 rounded-full border border-rule bg-surface px-4 text-body text-ink transition-colors duration-150 hover:border-ink-muted/60"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {turns.map((turn) => (
          <div key={turn.id} className="flex flex-col gap-2">
            <p className="ml-auto flex max-w-[85%] items-start gap-2 rounded-card rounded-br-[4px] border border-rule bg-surface px-3.5 py-2 text-body text-ink">
              <UserIcon className="mt-1 size-4 shrink-0 text-ink-muted" weight="bold" aria-hidden />
              <span className="break-words whitespace-pre-wrap">{turn.question}</span>
            </p>
            <Answer turn={turn} />
          </div>
        ))}
        <div ref={end} />
      </div>

      <form onSubmit={(e) => submit(text, e)} className="flex items-end gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">{t('knowledge.testPlaceholder')}</span>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('knowledge.testPlaceholder')}
            maxLength={1000}
            className="h-12 w-full rounded-control border border-rule bg-surface px-3.5 text-body text-ink placeholder:text-ink-muted/80 focus-visible:border-focus focus-visible:outline-2 focus-visible:outline-offset-0"
          />
        </label>
        <Button type="submit" size="lg" loading={ask.isPending} disabled={!text.trim()}>
          <PaperPlaneRightIcon weight="fill" aria-hidden />
          <span className="max-sm:sr-only">{t('knowledge.testAsk')}</span>
        </Button>
        {turns.length > 0 && (
          <IconButton label={t('knowledge.testReset')} onClick={restart} className="size-12">
            <ArrowCounterClockwiseIcon />
          </IconButton>
        )}
      </form>
    </div>
  )
}

function Answer({ turn }: { turn: Turn }) {
  const { t } = useTranslation()
  if (turn.error) return <p className="text-body text-danger-600">{turn.error}</p>
  const r = turn.result
  if (!r) {
    return (
      <p className="flex items-center gap-2 text-body text-ink-muted">
        <RobotIcon className="size-4" weight="bold" aria-hidden />
        {t('common.loading')}
      </p>
    )
  }
  return (
    <div className="flex max-w-[85%] flex-col gap-2">
      {r.reply && (
        <div className="rounded-card rounded-bl-[4px] bg-pottery-50 px-3.5 py-2 text-body text-ink">
          <span className="mb-0.5 flex items-center gap-1 text-small font-semibold text-pottery-600">
            <RobotIcon className="size-4" weight="bold" aria-hidden />
            {t('chat.botTag')}
          </span>
          <p className="break-words whitespace-pre-wrap">{r.reply}</p>
          {r.buttons.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5" aria-label={t('chat.buttonsSent')}>
              {r.buttons.map((b) => (
                <span
                  key={b.id}
                  className="rounded-full border border-rule bg-surface px-3 py-1 text-small text-ink-muted"
                >
                  {b.title}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      {r.handoff && (
        <div className="flex flex-col gap-1">
          <StatusPill tone="human" className="self-start">
            {t('knowledge.testWouldHandoff', {
              reason: t(`chat.reasons.${r.handoff.reason}`, { defaultValue: r.handoff.reason }),
            })}
          </StatusPill>
          {r.handoff.summary && <p className="text-small text-ink-muted">{r.handoff.summary}</p>}
        </div>
      )}
      {r.tools.length > 0 && (
        <p className="flex items-center gap-1.5 text-small text-ink-muted">
          <DatabaseIcon className="size-4 shrink-0" weight="bold" aria-hidden />
          {t('knowledge.testTools')}: {r.tools.join(', ')}
        </p>
      )}
      {r.kind !== 'handoff' &&
        (r.sources.length > 0 ? (
          <details className="text-small text-ink-muted">
            <summary className="flex min-h-11 cursor-pointer items-center gap-1.5">
              <FileTextIcon className="size-4 shrink-0" weight="bold" aria-hidden />
              {t('knowledge.testUsed')} ({r.sources.length})
            </summary>
            <ul className="mt-1 flex flex-col gap-2">
              {r.sources.map((s) => (
                <li
                  key={s.id}
                  className="rounded-control border border-rule bg-surface p-2 whitespace-pre-wrap text-ink"
                >
                  {s.content.length > 400 ? `${s.content.slice(0, 400)}…` : s.content}
                </li>
              ))}
            </ul>
          </details>
        ) : (
          <p className="text-small text-ink-muted">{t('knowledge.testNoSources')}</p>
        ))}
    </div>
  )
}
