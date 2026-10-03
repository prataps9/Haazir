import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import { LinkBreakIcon } from '@phosphor-icons/react'
import { Button } from '@/components/Button'
import { EmptyState } from '@/components/EmptyState'
import { Input } from '@/components/Input'
import { LanguageToggle } from '@/components/LanguageToggle'
import { Skeleton } from '@/components/Skeleton'
import { api, ApiError, post } from '@/lib/api'
import { usePreferences } from '@/lib/preferences'
import { useSession } from '@/lib/session-store'
import type { Role } from '@/lib/types'
import { AuthLayout } from './LoginPage'

interface InviteInfo {
  orgName: string
  email: string
  name: string | null
  role: Role
  hasAccount: boolean
}

/** Spec §16.1: the invite page. Set a password and language, then straight into the app. */
export default function InvitePage() {
  const { t } = useTranslation()
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const language = usePreferences((s) => s.language)
  const info = useQuery({
    queryKey: ['invite', token],
    queryFn: () => api<InviteInfo>(`/api/v1/invites/${token}`),
    retry: false,
  })
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { orgId } = await post<{ orgId: string }>(`/api/v1/invites/${token}/accept`, {
        name: name || undefined,
        password,
        uiLanguage: language,
      })
      useSession.getState().setOrgId(orgId)
      await qc.invalidateQueries({ queryKey: ['me'] })
      navigate('/', { replace: true })
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'UNAUTHENTICATED'
          ? t('auth.wrong')
          : err instanceof Error
            ? err.message
            : String(err),
      )
    } finally {
      setBusy(false)
    }
  }

  if (info.isPending) {
    return (
      <AuthLayout>
        <Skeleton className="mt-10 h-8 w-3/4" />
        <Skeleton className="mt-4 h-24 w-full" />
      </AuthLayout>
    )
  }
  if (info.isError || !info.data) {
    return (
      <AuthLayout>
        <EmptyState icon={LinkBreakIcon} title={t('auth.inviteExpired')} body="" className="mt-6" />
      </AuthLayout>
    )
  }

  const invite = info.data
  return (
    <AuthLayout>
      <h1 className="mt-8 text-h1 text-ink">{t('auth.inviteTitle', { org: invite.orgName })}</h1>
      <p className="mt-2 text-body text-ink-muted">
        {invite.hasAccount
          ? t('auth.inviteExisting')
          : t('auth.inviteBody', { role: t(`auth.roles.${invite.role}`) })}
      </p>
      <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
        <Input label={t('auth.email')} value={invite.email} readOnly disabled />
        {!invite.hasAccount && (
          <Input
            label={t('auth.name')}
            autoComplete="name"
            value={name}
            placeholder={invite.name ?? ''}
            onChange={(e) => setName(e.target.value)}
          />
        )}
        <Input
          label={invite.hasAccount ? t('auth.password') : t('auth.newPassword')}
          hint={invite.hasAccount ? undefined : t('auth.newPasswordHint')}
          type="password"
          autoComplete={invite.hasAccount ? 'current-password' : 'new-password'}
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={error ?? undefined}
        />
        {!invite.hasAccount && <LanguageToggle />}
        <Button
          type="submit"
          size="lg"
          block
          loading={busy}
          disabled={password.length < 8 || (!invite.hasAccount && !name && !invite.name)}
        >
          {t('auth.join')}
        </Button>
      </form>
    </AuthLayout>
  )
}
