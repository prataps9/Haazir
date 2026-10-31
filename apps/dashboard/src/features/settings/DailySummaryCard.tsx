import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { Input } from '@/components/Input'
import { Switch } from '@/components/Switch'
import { api, patch } from '@/lib/api'
import { errorText } from '@/lib/errors'
import { useMe } from '@/lib/session'
import { toast } from '@/lib/toast'
import { formatPhone } from '@/lib/types'
import { categoryRate } from '../templates/templateUi'

interface Prefs {
  handoffPush: boolean
  dailySummary: boolean
  phone: string | null
  canDailySummary: boolean
}

/**
 * "Aaj ka hisaab" on WhatsApp at 8 PM (spec §13 daily_summary): owners and
 * admins, to their own number. It's a utility template outside the chat
 * window, so it costs the institute about ₹0.12 a day; the card says so.
 */
export function DailySummaryCard() {
  const { t } = useTranslation()
  const { org } = useMe()
  const qc = useQueryClient()
  const prefs = useQuery({
    queryKey: ['notification-prefs', org?.id],
    enabled: !!org,
    queryFn: () => api<Prefs>('/api/v1/members/me/notifications'),
  })
  const [phone, setPhone] = useState('')
  useEffect(() => {
    if (prefs.data?.phone) setPhone(formatPhone(prefs.data.phone))
  }, [prefs.data?.phone])
  const save = useMutation({
    mutationFn: (body: Partial<Pick<Prefs, 'dailySummary' | 'phone'>>) =>
      patch<Prefs>('/api/v1/members/me/notifications', body),
    onSuccess: (data) => {
      qc.setQueryData(['notification-prefs', org?.id], data)
      toast({ title: t('settings.summarySaved') })
    },
    onError: (err) => toast({ title: errorText(err, t('common.failed')), tone: 'danger' }),
  })

  if (!prefs.data?.canDailySummary) return null
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate({ phone: phone.trim() || null })
  }
  return (
    <Card title={t('settings.summaryTitle')} description={t('settings.summaryBody')}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex items-end gap-2">
          <Input
            className="flex-1"
            label={t('settings.summaryPhone')}
            hint={t('settings.summaryPhoneHint')}
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <Button type="submit" size="md" variant="secondary" loading={save.isPending}>
            {t('common.save')}
          </Button>
        </div>
        <Switch
          label={t('settings.summarySwitch')}
          description={t('settings.summaryCost', { rate: categoryRate('utility') })}
          checked={prefs.data.dailySummary}
          disabled={!prefs.data.phone || save.isPending}
          onChange={(on) => save.mutate({ dailySummary: on })}
        />
      </form>
    </Card>
  )
}
