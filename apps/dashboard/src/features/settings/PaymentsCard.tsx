import { CheckCircleIcon, CopyIcon } from '@phosphor-icons/react'
import { useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { Input } from '@/components/Input'
import { StatusPill } from '@/components/StatusPill'
import { api } from '@/lib/api'
import { crm, useCrmMutation } from '@/lib/crm'
import { errorText } from '@/lib/errors'
import { useMe } from '@/lib/session'
import { toast } from '@/lib/toast'

interface PaymentsInfo {
  connected: boolean
  keyId: string | null
  status: string | null
  lastError: string | null
  webhookUrl: string
}

/** The institute's own Razorpay (spec §16.7 "Org payment setup"): fees go straight to them. */
export function PaymentsCard() {
  const { t } = useTranslation()
  const { org } = useMe()
  const canSee = org?.role === 'owner' || org?.role === 'admin'
  const info = useQuery({
    queryKey: ['payments', org?.id],
    enabled: canSee,
    queryFn: () => api<PaymentsInfo>('/api/v1/org/payments'),
  })
  const connect = useCrmMutation(crm.connectPayments)
  const disconnect = useCrmMutation(crm.disconnectPayments)
  const [keyId, setKeyId] = useState('')
  const [keySecret, setKeySecret] = useState('')
  const [webhookSecret, setWebhookSecret] = useState('')
  const [error, setError] = useState<string>()
  if (!canSee) return null
  const isOwner = org?.role === 'owner'

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setError(undefined)
    connect.mutate(
      { keyId, keySecret, webhookSecret },
      {
        onSuccess: () => {
          setKeySecret('')
          setWebhookSecret('')
          void info.refetch()
          toast({ title: t('payments.connected'), tone: 'success' })
        },
        onError: (err) => setError(errorText(err, t('common.failed'))),
      },
    )
  }

  return (
    <Card id="payments" title={t('payments.title')} description={t('payments.body')}>
      <div className="flex flex-col gap-4">
        {info.data?.connected && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <StatusPill tone="success" icon={CheckCircleIcon}>
              {t('payments.connected')} · {info.data.keyId}
            </StatusPill>
            {isOwner && (
              <Button
                variant="ghost"
                size="md"
                loading={disconnect.isPending}
                onClick={() =>
                  disconnect.mutate(undefined, { onSuccess: () => void info.refetch() })
                }
              >
                {t('payments.disconnect')}
              </Button>
            )}
          </div>
        )}
        {info.data && (
          <div className="flex flex-col gap-1.5">
            <p className="text-small text-ink-muted">{t('payments.webhookHint')}</p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 rounded-control bg-paper px-3 py-2 text-small break-all text-ink">
                {info.data.webhookUrl}
              </code>
              <Button
                variant="ghost"
                size="md"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(info.data!.webhookUrl)
                    .then(() => toast({ title: t('common.copied'), tone: 'success' }))
                }
              >
                <CopyIcon aria-hidden />
                <span className="sr-only">{t('common.copy')}</span>
              </Button>
            </div>
          </div>
        )}
        {!isOwner ? (
          <p className="text-small text-ink-muted">{t('payments.ownerOnly')}</p>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-3">
            <Input
              label={t('payments.keyId')}
              value={keyId}
              onChange={(e) => setKeyId(e.target.value)}
              placeholder="rzp_live_…"
              required
              autoComplete="off"
            />
            <Input
              label={t('payments.keySecret')}
              type="password"
              value={keySecret}
              onChange={(e) => setKeySecret(e.target.value)}
              required
              autoComplete="off"
            />
            <Input
              label={t('payments.webhookSecret')}
              type="password"
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
              required
              autoComplete="off"
            />
            {error && (
              <p role="alert" className="text-body text-danger-600">
                {error}
              </p>
            )}
            <Button
              type="submit"
              variant="secondary"
              size="md"
              className="self-start"
              loading={connect.isPending}
            >
              {t('payments.connect')}
            </Button>
          </form>
        )}
      </div>
    </Card>
  )
}
