import { cn } from '@/lib/cn'
import { JharokhaFrame } from './Jharokha'

const initials = (name: string) =>
  name
    .replace(/^\+/, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => [...w][0])
    .join('')
    .toUpperCase()

/** Contacts in the jharokha arch instead of a circle (spec §14.5), initials inside. */
export function Avatar({
  name,
  size = 'md',
  className,
}: {
  name: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const box = { sm: 'h-10 w-8 text-small', md: 'h-12 w-9 text-small', lg: 'h-16 w-12 text-h3' }[
    size
  ]
  return (
    <JharokhaFrame
      className={cn('shrink-0 bg-madder-50 pb-1.5 font-semibold text-madder-700', box, className)}
      aria-hidden
    >
      <span className="leading-none">
        {/^\d/.test(name.replace('+', '')) ? '#' : initials(name)}
      </span>
    </JharokhaFrame>
  )
}
