import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { api, ApiError } from './api'
import { authClient } from './auth-client'
import { usePreferences } from './preferences'
import { useSession } from './session-store'
import type { Me } from './types'

/** Who's logged in and which org the dashboard acts for. Null when logged out. */
export function useMe() {
  const query = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api<Me>('/api/v1/me')
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null
        throw err
      }
    },
    staleTime: 5 * 60_000,
  })
  const orgId = useSession((s) => s.orgId)
  const setOrgId = useSession((s) => s.setOrgId)
  const me = query.data

  // Keep the chosen org valid: first membership if none chosen or no longer a member.
  useEffect(() => {
    if (!me) return
    if (!orgId || !me.orgs.some((o) => o.id === orgId)) setOrgId(me.orgs[0]?.id ?? null)
  }, [me, orgId, setOrgId])

  const org = me?.orgs.find((o) => o.id === orgId) ?? me?.orgs[0] ?? null
  return { ...query, me, org }
}

export function useLogout() {
  const queryClient = useQueryClient()
  return async () => {
    await authClient.signOut()
    useSession.getState().setOrgId(null)
    queryClient.clear()
    window.location.assign('/login')
  }
}

/** Use the language saved on the account the first time someone logs in on a device. */
export function useAccountLanguage(me: Me | null | undefined) {
  useEffect(() => {
    if (!me) return
    const key = `haazir-lang-set-${me.user.id}`
    try {
      if (!localStorage.getItem(key)) {
        if (me.user.uiLanguage === 'hi' || me.user.uiLanguage === 'en')
          usePreferences.getState().setLanguage(me.user.uiLanguage)
        localStorage.setItem(key, '1')
      }
    } catch {
      /* private mode: keep the device default */
    }
  }, [me])
}
