import { CalendarPlusIcon, LinkSimpleIcon, UsersThreeIcon } from '@phosphor-icons/react'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { StatusPill } from '@/components/StatusPill'
import { api } from '@/lib/api'
import { crm, useCrmMutation, useLeadForContact, type FeeRow, type StudentRow } from '@/lib/crm'
import { errorText } from '@/lib/errors'
import { formatPaise } from '@/lib/format'
import { usePreferences } from '@/lib/preferences'
import { toast } from '@/lib/toast'
import { feeDate } from '@/features/fees/feeUi'
import { LeadSheet } from '@/features/leads/LeadSheet'
import { STAGE_TONE } from '@/features/leads/leadUi'

/**
 * The CRM side of a chat (spec §16.4 contact panel): the lead's stage with
 * "Book demo", or for a student the next fee with "Send payment link".
 */
export function LeadPanel({ contactId, waId }: { contactId: string; waId: string }) {
  const { t } = useTranslation()
  const lang = usePreferences((s) => s.language)
  const lead = useLeadForContact(contactId)
  const [open, setOpen] = useState(false)
  const student = useQuery({
    queryKey: ['students', waId],
    queryFn: () =>
      api<{ students: StudentRow[] }>(`/api/v1/students?q=${encodeURIComponent(waId)}`).then(
        (r) => r.students.find((s) => s.waId === waId) ?? null,
      ),
  })
  const nextFee = useQuery({
    queryKey: ['fees', 'student', student.data?.id],
    enabled: !!student.data,
    queryFn: () =>
      api<{ fees: FeeRow[] }>(`/api/v1/fees?status=open&student=${student.data!.id}`).then(
        (r) => r.fees[0] ?? null,
      ),
  })
  const link = useCrmMutation(crm.sendLink)

  return (
    <section className="flex flex-col gap-3 border-t border-rule pt-4">
      {lead && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-small font-semibold text-ink">{t('chatCrm.stage')}</span>
          <StatusPill tone={STAGE_TONE[lead.stage]}>{t(`stages.${lead.stage}`)}</StatusPill>
          {lead.courseName && <span className="text-small text-ink-muted">{lead.courseName}</span>}
        </div>
      )}
      {student.data && (
        <div className="flex flex-col gap-1">
          <p className="text-small font-semibold text-ink">
            {t('chatCrm.student')}: {student.data.name}
            {student.data.courseName ? ` · ${student.data.courseName}` : ''}
          </p>
          <p className="text-small text-ink-muted">
            {nextFee.data
              ? t('chatCrm.nextFee', {
                  amount: formatPaise(nextFee.data.amountPaise),
                  date: feeDate(nextFee.data.dueDate, lang),
                })
              : t('chatCrm.allPaid')}
          </p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {lead && (
          <Button variant="secondary" size="md" onClick={() => setOpen(true)}>
            {lead.stage === 'admitted' ? (
              <UsersThreeIcon aria-hidden />
            ) : (
              <CalendarPlusIcon aria-hidden />
            )}
            {lead.stage === 'admitted' ? t('leads.title') : t('chatCrm.bookDemo')}
          </Button>
        )}
        {nextFee.data && (
          <Button
            variant="secondary"
            size="md"
            loading={link.isPending}
            onClick={() =>
              link.mutate(nextFee.data!.id, {
                onSuccess: (r) =>
                  toast(
                    r.sent
                      ? { title: t('fees.linkSent'), tone: 'success' }
                      : {
                          title: t(`fees.notSent.${r.reason}`, {
                            defaultValue: t('common.failed'),
                          }),
                          tone: 'danger',
                        },
                  ),
                onError: (err) =>
                  toast({ title: errorText(err, t('common.failed')), tone: 'danger' }),
              })
            }
          >
            <LinkSimpleIcon aria-hidden />
            {t('chatCrm.paymentLink')}
          </Button>
        )}
      </div>
      <LeadSheet leadId={open ? (lead?.id ?? null) : null} onClose={() => setOpen(false)} />
    </section>
  )
}
