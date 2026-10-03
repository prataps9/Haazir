import { cn } from '@/lib/cn'

/** Loading placeholders shaped like the content (spec §16: skeletons matching layout). */
export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'block animate-pulse rounded-control bg-ink/8 motion-reduce:animate-none',
        className,
      )}
    />
  )
}

export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-busy="true" className="flex flex-col">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 border-b border-rule px-4 py-3">
          <Skeleton className="h-12 w-9" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  )
}
