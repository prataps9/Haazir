import { LockSimpleIcon } from '@phosphor-icons/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Page } from '@/app/Page'
import { Button } from '@/components/Button'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Input } from '@/components/Input'
import { SegmentedControl } from '@/components/SegmentedControl'
import { Skeleton } from '@/components/Skeleton'
import { StatusPill } from '@/components/StatusPill'
import { Switch } from '@/components/Switch'
import { Textarea } from '@/components/Textarea'
import { patch } from '@/lib/api'
import { errorText } from '@/lib/errors'
import { useMe } from '@/lib/session'
import { toast } from '@/lib/toast'
import { Playground } from '@/features/knowledge/Playground'
import { useBotConfig, type BotConfig, type Localised } from '@/features/knowledge/queries'

type Lang = keyof Localised
const LANGS: Lang[] = ['hi', 'hinglish', 'en']
const MENU_IDS = ['menu_courses', 'menu_demo', 'menu_talk'] as const
const MENU_MAX = 20

function useUpdateBot(orgId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Partial<BotConfig>) => patch<BotConfig>('/api/v1/bot', body),
    onSuccess: (config) => qc.setQueryData(['bot', orgId], config),
  })
}

/**
 * Bot settings (spec §16.11): the conversation structure is fixed in code;
 * owners change the words, the switches and the limits, and try the result
 * in the playground next to the form. Agents see everything read-only.
 */
export default function BotSettingsPage() {
  const { t } = useTranslation()
  const { org } = useMe()
  const bot = useBotConfig(org?.id)
  const canEdit = org?.role === 'owner' || org?.role === 'admin'

  return (
    <Page title={t('bot.title')}>
      {bot.isError ? (
        <p className="text-body text-danger-600">{t('common.loadError')}</p>
      ) : !bot.data ? (
        <div className="flex max-w-2xl flex-col gap-4" aria-busy="true">
          <Skeleton className="h-20" />
          <Skeleton className="h-64" />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_440px]">
          <div className="flex min-w-0 flex-col gap-4">
            <MasterSwitch config={bot.data} canEdit={canEdit} orgId={org?.id} />
            {!canEdit && (
              <p className="flex items-center gap-2 rounded-card border border-rule bg-surface px-4 py-3 text-body text-ink-muted">
                <LockSimpleIcon className="size-5 shrink-0" weight="bold" aria-hidden />
                {t('bot.readOnly')}
              </p>
            )}
            <BotForm config={bot.data} canEdit={canEdit} orgId={org?.id} />
          </div>
          <aside className="lg:sticky lg:top-6 lg:self-start" aria-labelledby="playground-title">
            <h2 id="playground-title" className="text-h3 text-ink">
              {t('bot.playground')}
            </h2>
            <p className="mt-1 mb-3 text-small text-ink-muted">{t('bot.playgroundHint')}</p>
            <Playground
              endpoint="bot"
              aiConfigured={bot.data.aiConfigured}
              suggestions={t('knowledge.suggestions', { returnObjects: true }) as string[]}
            />
          </aside>
        </div>
      )}
    </Page>
  )
}

function MasterSwitch({
  config,
  canEdit,
  orgId,
}: {
  config: BotConfig
  canEdit: boolean
  orgId?: string
}) {
  const { t } = useTranslation()
  const update = useUpdateBot(orgId)
  const [confirming, setConfirming] = useState(false)

  const set = (enabled: boolean) =>
    update.mutate(
      { enabled },
      {
        onSuccess: () => {
          setConfirming(false)
          toast({ title: t('bot.saved'), tone: 'success' })
        },
        onError: (err) => toast({ title: errorText(err, t('common.failed')), tone: 'danger' }),
      },
    )

  return (
    <section className="rounded-card border border-rule bg-surface p-4 sm:p-5">
      <Switch
        label={t('bot.masterSwitch')}
        checked={config.enabled}
        disabled={!canEdit || update.isPending}
        onChange={(on) => (on ? set(true) : setConfirming(true))}
      />
      <StatusPill tone={config.enabled ? 'bot' : 'human'} className="mt-2">
        {config.enabled ? t('bot.masterOn') : t('bot.masterOff')}
      </StatusPill>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('bot.confirmOff')}
        confirmLabel={t('common.yes')}
        cancelLabel={t('common.cancel')}
        danger
        loading={update.isPending}
        onConfirm={() => set(false)}
      />
    </section>
  )
}

const words = (list: string[]) => list.join(', ')
const unwords = (text: string) =>
  text
    .split(/[,،\n]/)
    .map((w) => w.trim())
    .filter(Boolean)

function BotForm({
  config,
  canEdit,
  orgId,
}: {
  config: BotConfig
  canEdit: boolean
  orgId?: string
}) {
  const { t } = useTranslation()
  const update = useUpdateBot(orgId)
  const [lang, setLang] = useState<Lang>('hi')
  const [personaName, setPersonaName] = useState(config.personaName)
  const [tone, setTone] = useState(config.tone)
  const [greeting, setGreeting] = useState<Localised>(config.greeting)
  const [afterHours, setAfterHours] = useState<Localised>(config.afterHoursMessage)
  const [menu, setMenu] = useState(() =>
    MENU_IDS.map((id) => ({ id, title: config.mainMenu.find((m) => m.id === id)?.title ?? {} })),
  )
  const [handoff, setHandoff] = useState(words(config.handoffKeywords))
  const [optout, setOptout] = useState(words(config.optoutKeywords))
  const [competitors, setCompetitors] = useState(words(config.competitorNames))
  const [limit, setLimit] = useState(String(config.maxAiRepliesPerContactHour))
  const [error, setError] = useState<string>()

  const tooLong = menu.some((m) => LANGS.some((l) => [...(m.title[l] ?? '')].length > MENU_MAX))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setError(undefined)
    update.mutate(
      {
        personaName,
        tone,
        greeting,
        afterHoursMessage: afterHours,
        mainMenu: menu,
        handoffKeywords: unwords(handoff),
        optoutKeywords: unwords(optout),
        competitorNames: unwords(competitors),
        maxAiRepliesPerContactHour: Number(limit),
      },
      {
        onSuccess: () => toast({ title: t('bot.saved'), tone: 'success' }),
        onError: (err) => setError(errorText(err, t('common.failed'))),
      },
    )
  }

  const langName = (l: Lang) => t(`contact.languages.${l}`)

  return (
    <form onSubmit={submit}>
      <fieldset disabled={!canEdit} className="flex flex-col gap-4">
        <Section title={t('bot.identity')}>
          <Input
            label={t('bot.persona')}
            value={personaName}
            onChange={(e) => setPersonaName(e.target.value)}
            required
            maxLength={40}
          />
          <SegmentedControl<'warm' | 'formal'>
            legend={t('bot.tone')}
            value={tone}
            onChange={setTone}
            options={[
              { value: 'warm', label: t('bot.toneWarm') },
              { value: 'formal', label: t('bot.toneFormal') },
            ]}
          />
        </Section>

        <Section title={t('bot.texts')} description={t('bot.textsHint')}>
          <SegmentedControl<Lang>
            legend={t('bot.editLanguage')}
            value={lang}
            onChange={setLang}
            options={LANGS.map((l) => ({ value: l, label: langName(l) }))}
          />
          <Textarea
            label={t('bot.greetingFor', { lang: langName(lang) })}
            value={greeting[lang] ?? ''}
            onChange={(e) => setGreeting({ ...greeting, [lang]: e.target.value })}
            maxLength={1000}
            rows={3}
          />
          <div className="flex flex-col gap-3">
            <div>
              <p className="text-small font-semibold text-ink">{t('bot.menu')}</p>
              <p className="text-small text-ink-muted">{t('bot.menuHint')}</p>
            </div>
            {menu.map((item, i) => {
              const value = item.title[lang] ?? ''
              const length = [...value].length
              return (
                <Input
                  key={item.id}
                  label={t(`bot.menuItems.${item.id}`)}
                  value={value}
                  onChange={(e) =>
                    setMenu(
                      menu.map((m, j) =>
                        j === i ? { ...m, title: { ...m.title, [lang]: e.target.value } } : m,
                      ),
                    )
                  }
                  hint={`${length}/${MENU_MAX}`}
                  error={length > MENU_MAX ? t('bot.menuTooLong', { max: MENU_MAX }) : undefined}
                />
              )
            })}
          </div>
          <Textarea
            label={`${t('bot.afterHours')} (${langName(lang)})`}
            hint={t('bot.afterHoursHint')}
            value={afterHours[lang] ?? ''}
            onChange={(e) => setAfterHours({ ...afterHours, [lang]: e.target.value })}
            maxLength={1000}
            rows={3}
          />
        </Section>

        <Section title={t('bot.keywords')} description={t('bot.wordsHint')}>
          <Textarea
            label={t('bot.handoffWords')}
            value={handoff}
            onChange={(e) => setHandoff(e.target.value)}
            rows={2}
          />
          <Textarea
            label={t('bot.optoutWords')}
            value={optout}
            onChange={(e) => setOptout(e.target.value)}
            rows={2}
            required
          />
          <Textarea
            label={t('bot.competitors')}
            value={competitors}
            onChange={(e) => setCompetitors(e.target.value)}
            rows={2}
          />
          <Input
            label={t('bot.limit')}
            type="number"
            inputMode="numeric"
            min={1}
            max={100}
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            required
            className="max-w-48"
          />
        </Section>

        {error && (
          <p role="alert" className="text-body text-danger-600">
            {error}
          </p>
        )}
        {canEdit && (
          <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] -mx-4 border-t border-rule bg-paper px-4 py-3 sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 lg:bottom-0">
            <Button type="submit" loading={update.isPending} disabled={tooLong}>
              {t('bot.save')}
            </Button>
          </div>
        )}
      </fieldset>
    </form>
  )
}

function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-4 rounded-card border border-rule bg-surface p-4 sm:p-5">
      <div>
        <h2 className="text-h3 text-ink">{title}</h2>
        {description && <p className="mt-1 text-small text-ink-muted">{description}</p>}
      </div>
      {children}
    </section>
  )
}
