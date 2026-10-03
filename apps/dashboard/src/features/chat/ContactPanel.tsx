import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Avatar } from '@/components/Avatar'
import { Button } from '@/components/Button'
import { Input } from '@/components/Input'
import { Skeleton } from '@/components/Skeleton'
import { StatusPill } from '@/components/StatusPill'
import { Textarea } from '@/components/Textarea'
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

      <StatusPill tone={optTone} className="self-start">
        {t(`contact.optIn.${contact.optInStatus}`)}
      </StatusPill>

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
