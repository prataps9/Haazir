import { ArrowsClockwiseIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { SequenceTrigger } from '@haazir/shared'
import { SEQUENCE_TRIGGERS } from '@haazir/shared'
import { Page } from '@/app/Page'
import { Button, IconButton } from '@/components/Button'
import { Card } from '@/components/Card'
import { EmptyState } from '@/components/EmptyState'
import { Input } from '@/components/Input'
import { Select } from '@/components/Select'
import { Skeleton } from '@/components/Skeleton'
import { Switch } from '@/components/Switch'
import { formatPaise } from '@/lib/format'
import {
  useSaveSequence,
  useSequences,
  type SequencesData,
  type SequenceView,
} from '@/lib/sequences'
import { toast } from '@/lib/toast'
import { growthError } from '../templates/templateUi'

/**
 * Follow-up sequences (owners and admins): three fixed moments in a lead's
 * journey, each with up to three template messages. Off until switched on, and
 * a sequence only ever reaches people who said yes to updates.
 */
export default function SequencesPage() {
  const { t } = useTranslation()
  const data = useSequences()
  return (
    <Page title={t('sequences.title')}>
      <div className="flex flex-col gap-4">
        <p className="max-w-prose text-body text-ink-muted">{t('sequences.intro')}</p>
        {data.isError ? (
          <p className="text-body text-danger-600">{t('common.loadError')}</p>
        ) : !data.data ? (
          <Skeleton className="h-72" />
        ) : data.data.templates.length === 0 ? (
          <EmptyState
            icon={ArrowsClockwiseIcon}
            title={t('sequences.noTemplatesTitle')}
            body={t('sequences.noTemplatesBody')}
          />
        ) : (
          SEQUENCE_TRIGGERS.map((trigger) => (
            <Editor
              key={trigger}
              data={data.data}
              sequence={data.data.sequences.find((s) => s.trigger === trigger)!}
            />
          ))
        )}
      </div>
    </Page>
  )
}

/** Hours from the trigger, shown in the unit a person thinks in. */
const toDays = (hours: number) =>
  hours % 24 === 0 ? hours / 24 : Math.round((hours / 24) * 10) / 10

function Editor({ data, sequence }: { data: SequencesData; sequence: SequenceView }) {
  const { t } = useTranslation()
  const save = useSaveSequence()
  const initial = sequence.steps.filter((s) => s.templateId)
  const [enabled, setEnabled] = useState(sequence.enabled)
  const [steps, setSteps] = useState(
    initial.map((s) => ({ days: String(toDays(s.delayHours)), templateId: s.templateId! })),
  )
  const [error, setError] = useState<string>()
  const trigger: SequenceTrigger = sequence.trigger

  // What one lead could cost at most, worked out from the steps as they stand.
  const worst = Math.round(
    steps.reduce((sum, s) => {
      const tpl = data.templates.find((x) => x.id === s.templateId)
      return sum + (tpl ? (data.rates[tpl.category] ?? 0) : 0)
    }, 0) / 100,
  )
  const hours = steps.map((s) => Math.round(Number(s.days) * 24))
  const ordered = hours.every((h, i) => h >= 1 && (i === 0 || h > hours[i - 1]!))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setError(undefined)
    save.mutate(
      {
        trigger,
        enabled,
        steps: steps.map((s, i) => ({ delayHours: hours[i]!, templateId: s.templateId })),
      },
      {
        onSuccess: () => toast({ title: t('sequences.saved'), tone: 'success' }),
        onError: (err) => setError(growthError(err, t)),
      },
    )
  }

  const { active, done, stopped } = sequence.counts
  return (
    <Card
      title={t(`sequences.triggers.${trigger}.title`)}
      description={t(`sequences.triggers.${trigger}.body`)}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <ol className="flex flex-col gap-3">
          {steps.map((s, i) => (
            <li
              key={i}
              className="flex flex-wrap items-end gap-3 rounded-card border border-rule p-3"
            >
              <Input
                className="w-32"
                label={t('sequences.afterDays', { n: i + 1 })}
                type="number"
                inputMode="decimal"
                min={0.05}
                step="any"
                value={s.days}
                onChange={(e) =>
                  setSteps(steps.map((x, j) => (j === i ? { ...x, days: e.target.value } : x)))
                }
                required
              />
              <Select
                className="min-w-0 flex-1 basis-56"
                label={t('sequences.message')}
                value={s.templateId}
                onChange={(e) =>
                  setSteps(
                    steps.map((x, j) => (j === i ? { ...x, templateId: e.target.value } : x)),
                  )
                }
              >
                {!data.templates.some((x) => x.id === s.templateId) && (
                  <option value={s.templateId}>{t('sequences.unusable')}</option>
                )}
                {data.templates.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} ({t(`templates.categories.${x.category}`)})
                  </option>
                ))}
              </Select>
              <IconButton
                label={t('sequences.removeStep', { n: i + 1 })}
                onClick={() => setSteps(steps.filter((_, j) => j !== i))}
              >
                <TrashIcon />
              </IconButton>
              <p className="basis-full text-small text-ink-muted">
                {data.templates.find((x) => x.id === s.templateId)?.body}
              </p>
            </li>
          ))}
        </ol>

        {steps.length < data.maxSteps && (
          <div>
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                setSteps([
                  ...steps,
                  {
                    days: String(steps.length ? Number(steps.at(-1)!.days) + 2 : 1),
                    templateId: data.templates[0]!.id,
                  },
                ])
              }
            >
              <PlusIcon aria-hidden />
              {t('sequences.addStep')}
            </Button>
          </div>
        )}

        {steps.length > 0 && (
          <p className="rounded-card border border-rule bg-surface p-3 text-small text-ink">
            {t('sequences.cost', { amount: formatPaise(worst) })}
          </p>
        )}

        <Switch
          label={t('sequences.on')}
          description={enabled ? t('sequences.onHint') : t('sequences.offHint')}
          checked={enabled}
          onChange={setEnabled}
        />

        {error && (
          <p role="alert" className="text-body text-danger-600">
            {error}
          </p>
        )}
        {!ordered && steps.length > 1 && (
          <p className="text-small text-danger-600">{t('sequences.order')}</p>
        )}
        <div className="flex flex-wrap items-center gap-4">
          <Button
            type="submit"
            loading={save.isPending}
            disabled={!ordered || (enabled && steps.length === 0)}
          >
            {t('common.save')}
          </Button>
          {active + done + stopped > 0 && (
            <p className="text-small text-ink-muted">
              {t('sequences.counts', { active, done, stopped })}
            </p>
          )}
        </div>
      </form>
    </Card>
  )
}
