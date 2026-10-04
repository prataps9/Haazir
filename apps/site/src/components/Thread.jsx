import { useEffect, useRef, useState } from 'react'
import { CheckCheck, ChevronLeft, Mic, RotateCcw, UserRound } from 'lucide-react'
import { useInView, usePrefersReducedMotion } from '../lib/hooks'

const TYPING_MS = 600
const READING_MS = 450

/**
 * A scripted WhatsApp thread that plays out message by message, inside a phone.
 * The product is a chat, so this is the demo — which is why it is the hero.
 *
 * It starts when it enters view, which for the hero means immediately. Under
 * reduced motion the whole exchange renders at once: the exchange is the
 * content, the timing is decoration.
 */
export default function Thread({ opened, messages, handover, className = '' }) {
  const reduced = usePrefersReducedMotion()
  const [ref, inView] = useInView({ threshold: 0 })

  const [shown, setShown] = useState(0)
  const [typing, setTyping] = useState(false)
  const timers = useRef([])

  const clearTimers = () => {
    timers.current.forEach(clearTimeout)
    timers.current = []
  }

  const play = () => {
    clearTimers()
    setShown(0)
    setTyping(false)

    let at = 400 // a beat, so the page settles before it starts
    messages.forEach((message, i) => {
      if (message.who === 'agent') {
        at += READING_MS
        timers.current.push(setTimeout(() => setTyping(true), at))
        at += TYPING_MS
        timers.current.push(
          setTimeout(() => {
            setTyping(false)
            setShown(i + 1)
          }, at),
        )
      } else {
        at += i === 0 ? 0 : READING_MS
        timers.current.push(setTimeout(() => setShown(i + 1), at))
      }
    })
  }

  useEffect(() => {
    if (reduced) {
      setShown(messages.length)
      setTyping(false)
      return
    }
    if (inView) play()
    return clearTimers
  }, [inView, reduced, messages])

  const finished = shown >= messages.length

  return (
    <figure ref={ref} className={className}>
      {/* The handset */}
      <div className="rounded-[2.5rem] bg-ink p-2.5 shadow-[0_40px_70px_-34px_rgb(14_16_19_/_0.55),0_2px_0_rgb(255_255_255_/_0.06)_inset]">
        <div className="overflow-hidden rounded-[2rem] bg-paper">
          <figcaption className="flex items-center gap-2.5 bg-forest px-3 py-3 text-paper">
            <ChevronLeft className="h-5 w-5 shrink-0 text-paper/80" strokeWidth={1.8} aria-hidden="true" />
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-paper/15">
              <UserRound className="h-[1.1rem] w-[1.1rem]" strokeWidth={1.8} />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[0.95rem] leading-tight font-medium">Customer</span>
              <span className="block text-[0.74rem] leading-tight text-paper/75">{opened}</span>
            </span>
            <span className="ml-auto flex shrink-0 items-center gap-1.5 rounded-full bg-paper/12 py-1 pr-2.5 pl-2 text-[0.72rem] text-paper">
              <span className="h-1.5 w-1.5 rounded-full bg-[#4ade80]" aria-hidden="true" />
              Live
            </span>
          </figcaption>

          {/* A floor under the bubbles so the phone does not resize as it fills. */}
          <div className="wa-wallpaper flex min-h-[25rem] flex-col justify-end gap-2 px-3 py-4">
            {messages.slice(0, shown).map((message, i) => (
              <p
                key={i}
                className={`animate-message-in relative max-w-[86%] rounded-2xl px-3 py-2 text-[0.9rem] leading-snug text-ink shadow-[0_1px_1px_rgb(14_16_19_/_0.08)] ${
                  message.who === 'agent'
                    ? 'ml-auto rounded-tr-md bg-mint pr-12'
                    : 'rounded-tl-md bg-white pr-3'
                }`}
              >
                {message.text}
                {message.who === 'agent' && (
                  <CheckCheck
                    className="absolute right-2 bottom-1.5 h-3.5 w-3.5 text-tick"
                    strokeWidth={2.2}
                    aria-hidden="true"
                  />
                )}
              </p>
            ))}

            {typing && (
              <span
                className="ml-auto flex w-fit items-center gap-1 rounded-2xl rounded-tr-md bg-mint px-4 py-3 shadow-[0_1px_1px_rgb(14_16_19_/_0.08)]"
                aria-label="typing"
              >
                <Dot /> <Dot delay="150ms" /> <Dot delay="300ms" />
              </span>
            )}

            {finished && (
              <p className="animate-message-in mx-auto mt-1 flex items-center gap-2 rounded-full bg-white px-3.5 py-1.5 text-[0.76rem] text-ink/75 shadow-[0_1px_1px_rgb(14_16_19_/_0.08)]">
                <span className="h-1.5 w-1.5 rounded-full bg-clay" aria-hidden="true" />
                {handover}
              </p>
            )}
          </div>

          {/* The message box, for show. */}
          <div className="flex items-center gap-2 bg-paper px-3 pt-2.5 pb-3.5" aria-hidden="true">
            <span className="flex-1 rounded-full bg-white px-4 py-2 text-[0.85rem] text-ink/65 ring-1 ring-line">
              Message
            </span>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-forest text-paper">
              <Mic className="h-4 w-4" strokeWidth={1.8} />
            </span>
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-center gap-3 text-[0.82rem] text-ink/65">
        <span>A real exchange, start to hand-off. Nobody on the team was awake.</span>
        {finished && !reduced && (
          <button
            type="button"
            onClick={play}
            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-line bg-white px-2.5 py-1 text-ink/70 transition-colors hover:text-clay-deep"
          >
            <RotateCcw className="h-3 w-3" strokeWidth={2} />
            Replay
          </button>
        )}
      </div>
    </figure>
  )
}

function Dot({ delay = '0ms' }) {
  return (
    <span
      className="animate-typing h-1.5 w-1.5 rounded-full bg-ink/45"
      style={{ animationDelay: delay }}
    />
  )
}
