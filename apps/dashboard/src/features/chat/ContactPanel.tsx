import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Avatar } from '@/components/Avatar'
import { Button } from '@/components/Button'
import { Input } from '@/components/Input'
import { Skeleton } from '@/components/Skeleton'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { StatusPill, type StatusTone } from '@/components/StatusPill'
import { LeadPanel } from './LeadPanel'
import { Textarea } from '@/components/Textarea'
import { ApiError } from '@/lib/api'
import { errorText } from '@/lib/errors'
import { usePreferences } from '@/lib/preferences'
import { dayLabel } from '@/lib/time'
import { toast } from '@/lib/toast'
import { displayName, formatPhone } from '@/lib/types'
import { useContact, useUpdateContact } from './queries'

/**
 * Spec §16.4 contact panel: desktop right pane or phone sheet. Lead stage,
 * course interest and fee status join in Phase 4 with those tables.
 */
export function ContactPanel({ contactId }: { contactId: string }) {
  const { t } = useTranslation()
  const lang = usePreferences((s) => s.language)
  const { data: contact } = useContact(contactId)
  const update = useUpdateContact(contactId)
  const [name, setName] = useState('')
  const [tags, setTags] = useState('')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (!contact) return
    setName(contact.name ?? '')
    setTags(contact.tags.join(', '))
    setNotes(contact.notes ?? '')
  }, [contact])

  if (!contact) {
    return (
      <div className="space-y-4 p-5" aria-busy="true">
        <Skeleton className="h-16 w-12" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }

  const dirty =
    name !== (contact.name ?? '') ||
    tags !== contact.tags.join(', ') ||
    notes !== (contact.notes ?? '')
  const save = () =>
    update.mutate(
      {
        name: name.trim() || null,
        tags: tags
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        notes: notes.trim() || null,
      },
      {
        onSuccess: () => toast({ title: t('contact.saved') }),
        onError: () => toast({ title: t('common.loadError'), tone: 'danger' }),
      },
    )

  const optTone =
    contact.optInStatus === 'opted_out'
      ? 'danger'
      : contact.optInStatus === 'opted_in'
        ? 'success'
        : 'neutral'
  return (
    <div className="flex flex-col gap-5 p-5">
      <div className="flex items-center gap-3">
        <Avatar name={displayName(contact)} size="lg" />
        <div className="min-w-0">
          <p className="truncate text-h3 text-ink">{displayName(contact)}</p>
          <p className="text-small text-ink-muted">{formatPhone(contact.waId)}</p>
        </div>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-small">
        {contact.profileName && (
          <>
            <dt className="text-ink-muted">{t('contact.whatsappName')}</dt>
            <dd className="text-ink">{contact.profileName}</dd>
          </>
        )}
        {contact.language && (
          <>
            <dt className="text-ink-muted">{t('contact.language')}</dt>
            <dd className="text-ink">
              {t(`contact.languages.${contact.language}`, { defaultValue: contact.language })}
            </dd>
          </>
        )}
        <dt className="text-ink-muted">{t('contact.firstSeen')}</dt>
        <dd className="text-ink">{dayLabel(contact.createdAt, lang)}</dd>
      </dl>

      <Consent
        status={contact.optInStatus}
        source={contact.optInSource}
        at={contact.optInAt}
        tone={optTone}
        pending={update.isPending}
        onRecord={(optIn) =>
          update.mutate(
            { optIn },
            {
              onSuccess: () => toast({ title: t('contact.consentSaved') }),
              onError: (err) =>
                toast({
                  title:
                    err instanceof ApiError &&
                    (err.details as { reason?: string } | undefined)?.reason === 'opted_out'
                      ? t('contact.consentStop')
                      : errorText(err, t('common.failed')),
                  tone: 'danger',
                }),
            },
          )
        }
      />

      <LeadPanel contactId={contact.id} waId={contact.waId} />

      <Input
        label={t('contact.name')}
        placeholder={t('contact.namePlaceholder')}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <Input
        label={t('contact.tags')}
        hint={t('contact.tagsHint')}
        value={tags}
        onChange={(e) => setTags(e.target.value)}
      />
      <Textarea
        label={t('contact.notes')}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        maxLength={2000}
      />
      <Button
        variant="secondary"
        onClick={save}
        disabled={!dirty}
        loading={update.isPending}
        className="self-start"
      >
        {t('contact.save')}
      </Button>
    </div>
  )
}

/**
 * Consent for updates and offers (spec §19: a record with source and time).
 * Campaigns only ever go to a "yes"; a STOP can only be undone by the person.
 */
function Consent({
  status,
  source,
  at,
  tone,
  pending,
  onRecord,
}: {
  status: 'opted_in' | 'opted_out' | 'unknown'
  source: string | null
  at: string | null
  tone: StatusTone
  pending: boolean
  onRecord(optIn: boolean): void
}) {
  const { t } = useTranslation()
  const lang = usePreferences((s) => s.language)
  const [asking, setAsking] = useState(false)
  return (
    <div className="flex flex-col items-start gap-2">
      <StatusPill tone={tone}>{t(`contact.optIn.${status}`)}</StatusPill>
      {status === 'opted_in' && at && (
        <p className="text-small text-ink-muted">
          {t('contact.consentSince', {
            when: dayLabel(at, lang),
            source: t(`contact.consentSources.${source ?? 'other'}`, {
              defaultValue: t('contact.consentSources.other'),
            }),
          })}
        </p>
      )}
      {status === 'opted_out' && (
        <p className="text-small text-ink-muted">{t('contact.consentStop')}</p>
      )}
      {status === 'unknown' && (
        <Button size="md" variant="secondary" loading={pending} onClick={() => setAsking(true)}>
          {t('contact.recordYes')}
        </Button>
      )}
      {status === 'opted_in' && source !== 'team' && (
        <Button size="md" variant="ghost" loading={pending} onClick={() => onRecord(false)}>
          {t('contact.recordNo')}
        </Button>
      )}
      <ConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        title={t('contact.recordYesTitle')}
        body={t('contact.recordYesBody')}
        confirmLabel={t('contact.recordYesConfirm')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => {
          setAsking(false)
          onRecord(true)
        }}
      />
    </div>
  )
}
