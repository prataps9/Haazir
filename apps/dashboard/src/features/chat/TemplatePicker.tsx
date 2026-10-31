import { CardsIcon, PaperPlaneRightIcon } from '@phosphor-icons/react'
import { fillTemplate } from '@haazir/shared'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Button } from '@/components/Button'
import { EmptyState } from '@/components/EmptyState'
import { Input } from '@/components/Input'
import { Sheet } from '@/components/Sheet'
import { ListSkeleton } from '@/components/Skeleton'
import { growth, useChatTemplates, useGrowthMutation, type ChatTemplate } from '@/lib/growth'
import { toast } from '@/lib/toast'
import { useMe } from '@/lib/session'
import { growthError, languageLabel } from '../templates/templateUi'
import { WhatsAppPreview } from '../templates/WhatsAppPreview'

/**
 * Once the 24-hour window has closed, WhatsApp only lets a business start
 * again with an approved template (spec §10). Pick one, fill its blanks
 * (name, course and batch come filled in), see it, send it.
 */
export function TemplatePicker({
  conversationId,
  open,
  onOpenChange,
}: {
  conversationId: string
  open: boolean
  onOpenChange(open: boolean): void
}) {
  const { t } = useTranslation()
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('chat.templateTitle')}
      closeLabel={t('common.close')}
    >
      {open && <Picker conversationId={conversationId} onSent={() => onOpenChange(false)} />}
    </Sheet>
  )
}

function Picker({ conversationId, onSent }: { conversationId: string; onSent(): void }) {
  const { t } = useTranslation()
  const { org } = useMe()
  const qc = useQueryClient()
  const templates = useChatTemplates(conversationId, true)
  const [picked, setPicked] = useState<ChatTemplate | null>(null)
  const [values, setValues] = useState<string[]>([])
  const [allLanguages, setAllLanguages] = useState(false)
  const send = useGrowthMutation(growth.sendChatTemplate)

  if (templates.isPending)
    return (
      <div className="p-5">
        <ListSkeleton rows={3} />
      </div>
    )
  if (templates.isError)
    return <p className="p-5 text-body text-danger-600">{t('common.loadError')}</p>
  if (!templates.data.length)
    return (
      <EmptyState
        className="m-5"
        icon={CardsIcon}
        title={t('chat.noTemplatesTitle')}
        body={t('chat.noTemplatesBody')}
        action={
          org?.role !== 'agent' ? (
            <Button asChild size="md" variant="secondary">
              <Link to="/templates">{t('campaigns.openTemplates')}</Link>
            </Button>
          ) : undefined
        }
      />
    )

  const shown = allLanguages ? templates.data : templates.data.filter((x) => x.preferred)
  const pick = (x: ChatTemplate) => {
    setPicked(x)
    setValues(x.suggested)
  }

  return (
    <div className="flex flex-col gap-4 p-5">
      {picked ? (
        <div className="flex items-start justify-between gap-3 rounded-card border border-madder-700 bg-madder-50 p-3">
          <span className="min-w-0">
            <span className="block text-body font-semibold text-ink">
              {picked.purpose === 'custom'
                ? picked.name
                : t(`templates.purposes.${picked.purpose}`)}
            </span>
            <span className="block text-small text-ink-muted">
              {languageLabel(t, picked.name, picked.language)}
            </span>
          </span>
          <Button size="md" variant="ghost" onClick={() => setPicked(null)}>
            {t('chat.pickAnother')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2" role="group" aria-labelledby="pick-template">
          <h3 id="pick-template" className="mb-1 text-small font-semibold text-ink">
            {t('chat.pickTemplate')}
          </h3>
          {shown.map((x) => (
            <button
              key={x.id}
              type="button"
              onClick={() => pick(x)}
              className="flex flex-col rounded-card border border-rule bg-surface p-3 text-left hover:border-ink-muted/60"
            >
              <span className="block text-body font-semibold text-ink">
                {x.purpose === 'custom' ? x.name : t(`templates.purposes.${x.purpose}`)}
              </span>
              <span className="block text-small text-ink-muted">
                {languageLabel(t, x.name, x.language)}
              </span>
              <span className="mt-1 line-clamp-2 block text-small text-ink">{x.body}</span>
            </button>
          ))}
          {!allLanguages && shown.length < templates.data.length && (
            <Button
              size="md"
              variant="ghost"
              className="self-start"
              onClick={() => setAllLanguages(true)}
            >
              {t('chat.allLanguages')}
            </Button>
          )}
        </div>
      )}

      {picked && (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            send.mutate(
              { conversationId, templateId: picked.id, values },
              {
                onSuccess: () => {
                  void qc.invalidateQueries({ queryKey: ['messages', conversationId] })
                  toast({ title: t('chat.templateSent') })
                  onSent()
                },
                onError: (err) => toast({ title: growthError(err, t), tone: 'danger' }),
              },
            )
          }}
        >
          {values.map((v, i) => (
            <Input
              key={i}
              label={t('chat.blankN', { n: i + 1 })}
              value={v}
              maxLength={200}
              required
              onChange={(e) => setValues(values.map((x, j) => (j === i ? e.target.value : x)))}
            />
          ))}
          <WhatsAppPreview
            body={fillTemplate(
              picked.body,
              values.map((v, i) => v || `{{${i + 1}}}`),
            )}
          />
          <Button type="submit" loading={send.isPending} disabled={values.some((v) => !v.trim())}>
            <PaperPlaneRightIcon weight="fill" aria-hidden />
            {t('chat.sendTemplate')}
          </Button>
        </form>
      )}
    </div>
  )
}
