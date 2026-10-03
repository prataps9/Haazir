import { BellIcon, BellSlashIcon } from '@phosphor-icons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Page } from '@/app/Page'
import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { LanguageToggle, ThemeToggle } from '@/components/LanguageToggle'
import { StatusPill } from '@/components/StatusPill'
import { Switch } from '@/components/Switch'
import { api, patch } from '@/lib/api'
import { errorText } from '@/lib/errors'
import { usePush } from '@/lib/push'
import { useMe } from '@/lib/session'
import { toast } from '@/lib/toast'

/**
 * Settings (§16.15). Display preferences and notifications for now; business
 * profile, hours, WhatsApp, payments and privacy tools arrive in later phases.
 */
export default function SettingsPage() {
  const { t } = useTranslation()
  return (
    <Page title={t('nav.settings')}>
      <div className="flex max-w-xl flex-col gap-4">
        <Notifications />
        <Card title={t('settings.display')} description={t('settings.displayBody')}>
          <div className="flex flex-col gap-5">
            <LanguageToggle />
            <ThemeToggle />
          </div>
        </Card>
      </div>
    </Page>
  )
}

/** Handoff alerts on this phone (spec §17): the bot gives up, the team's phone buzzes. */
function Notifications() {
  const { t } = useTranslation()
  const { org } = useMe()
  const qc = useQueryClient()
  const push = usePush()
  const [busy, setBusy] = useState(false)

  const prefs = useQuery({
    queryKey: ['notification-prefs', org?.id],
    enabled: !!org,
    queryFn: () => api<{ handoffPush: boolean }>('/api/v1/members/me/notifications'),
  })
  const setPref = useMutation({
    mutationFn: (handoffPush: boolean) =>
      patch<{ handoffPush: boolean }>('/api/v1/members/me/notifications', { handoffPush }),
    onSuccess: (data) => qc.setQueryData(['notification-prefs', org?.id], data),
    onError: (err) => toast({ title: errorText(err, t('common.failed')), tone: 'danger' }),
  })

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    try {
      await action()
    } catch (err) {
      toast({ title: errorText(err, t('common.failed')), tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  const blocked =
    push.state === 'unsupported' || push.state === 'denied' || push.state === 'not-configured'

  return (
    <Card
      id="notifications"
      title={t('settings.notifications')}
      description={t('settings.notificationsBody')}
    >
      <div className="flex flex-col gap-4">
        {push.state === 'on' ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <StatusPill tone="success" icon={BellIcon}>
              {t('settings.pushOn')}
            </StatusPill>
            <Button
              variant="secondary"
              size="md"
              loading={busy}
              onClick={() => void run(push.disable)}
            >
              <BellSlashIcon aria-hidden />
              {t('settings.disablePush')}
            </Button>
          </div>
        ) : blocked ? (
          <p className="text-body text-ink-muted">
            {push.state === 'denied'
              ? t('settings.pushDenied')
              : push.state === 'not-configured'
                ? t('settings.pushNotConfigured')
                : t('settings.pushUnsupported')}
          </p>
        ) : (
          <Button
            size="md"
            className="self-start"
            loading={busy || push.state === 'checking'}
            onClick={() => void run(push.enable)}
          >
            <BellIcon aria-hidden />
            {t('settings.enablePush')}
          </Button>
        )}
        {push.state === 'on' && (
          <p className="text-small text-ink-muted">{t('settings.pushTestHint')}</p>
        )}
        {org && (
          <Switch
            label={t('settings.handoffAlerts')}
            description={t('settings.handoffAlertsHint')}
            checked={prefs.data?.handoffPush ?? true}
            disabled={!prefs.data || setPref.isPending}
            onChange={(on) => setPref.mutate(on)}
          />
        )}
      </div>
    </Card>
  )
}
