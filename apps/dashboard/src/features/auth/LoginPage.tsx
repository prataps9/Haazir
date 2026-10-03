import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { WarningCircleIcon } from '@phosphor-icons/react'
import { Button } from '@/components/Button'
import { Input } from '@/components/Input'
import { Wordmark } from '@/components/Jharokha'
import { LanguageToggle } from '@/components/LanguageToggle'
import { authClient } from '@/lib/auth-client'
import { useMe } from '@/lib/session'

/** Spec §16.1: single column, the mark at the top, email + password, no marketing. */
export default function LoginPage() {
  const { t } = useTranslation()
  const { me, isPending } = useMe()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const qc = useQueryClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showForgot, setShowForgot] = useState(false)

  if (!isPending && me) return <Navigate to={params.get('next') || '/'} replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error: err } = await authClient.signIn.email({ email: email.trim(), password })
    setBusy(false)
    if (err) return setError(t('auth.wrong'))
    await qc.invalidateQueries({ queryKey: ['me'] })
    navigate(params.get('next') || '/', { replace: true })
  }

  return (
    <AuthLayout>
      <h1 className="mt-8 text-h1 text-ink">{t('auth.title')}</h1>
      <form onSubmit={submit} className="mt-6 flex flex-col gap-4" noValidate>
        <Input
          label={t('auth.email')}
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Input
          label={t('auth.password')}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && (
          <p role="alert" className="flex items-start gap-2 text-small text-danger-600">
            <WarningCircleIcon className="mt-0.5 size-4 shrink-0" weight="bold" aria-hidden />
            {error}
          </p>
        )}
        <Button type="submit" size="lg" block loading={busy} disabled={!email || !password}>
          {busy ? t('auth.loggingIn') : t('auth.login')}
        </Button>
      </form>
      <button
        type="button"
        onClick={() => setShowForgot((v) => !v)}
        aria-expanded={showForgot}
        className="mt-4 min-h-11 text-body font-semibold text-madder-700 underline-offset-2 hover:underline"
      >
        {t('auth.forgot')}
      </button>
      {showForgot && <p className="text-body text-ink-muted">{t('auth.forgotHelp')}</p>}
    </AuthLayout>
  )
}

export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-paper">
      <div className="mx-auto flex w-full max-w-sm flex-col px-4 pt-6 pb-10">
        <div className="flex items-center justify-between gap-4">
          <Wordmark />
          <LanguageToggle className="w-40 [&_legend]:sr-only" />
        </div>
        {children}
      </div>
    </div>
  )
}
