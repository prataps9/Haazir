import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { useAccountLanguage, useMe } from '@/lib/session'

/** Logged-out visitors go to /login and come back to where they were after. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { me, isPending } = useMe()
  const location = useLocation()
  useAccountLanguage(me)
  if (isPending) return <div className="min-h-dvh bg-paper" aria-busy="true" />
  if (!me)
    return (
      <Navigate
        to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`}
        replace
      />
    )
  return <>{children}</>
}
