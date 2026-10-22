import {
  BellRingingIcon,
  CurrencyInrIcon,
  LinkSimpleIcon,
  MoneyIcon,
  UserPlusIcon,
} from '@phosphor-icons/react'
import { PAID_VIA } from '@haazir/shared'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import { Page } from '@/app/Page'
import { Button } from '@/components/Button'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { Input } from '@/components/Input'
import { SegmentedControl } from '@/components/SegmentedControl'
import { Select } from '@/components/Select'
import { Sheet } from '@/components/Sheet'
import { ListSkeleton, Skeleton } from '@/components/Skeleton'
import { StatusPill } from '@/components/StatusPill'
import { Tabs } from '@/components/Tabs'
import {
  crm,
  useCourses,
  useCrmMutation,
  useFees,
  useOrg,
  useStudent,
  type FeeRow,
} from '@/lib/crm'
import { errorText } from '@/lib/errors'
import { formatPaise } from '@/lib/format'
import { usePreferences } from '@/lib/preferences'
import { toast } from '@/lib/toast'
import { formatPhone } from '@/lib/types'
import { FEE_TONE, feeDate } from './feeUi'

type Tab = 'month' | 'overdue' | 'paid' | 'all'
const TABS: Tab[] = ['month', 'overdue', 'paid', 'all']
const STATUS: Record<Tab, string> = { month: 'all', overdue: 'overdue', paid: 'paid', all: 'all' }

const istMonth = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 7)

/** Fees (spec §16.7): what's due, what came in, and one tap to chase it. */
export default function FeesPage() {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const tab = TABS.includes(params.get('tab') as Tab) ? (params.get('tab') as Tab) : 'month'
  const fees = useFees(STATUS[tab], tab === 'month' ? istMonth() : undefined)
  const org = useOrg()
  const [paying, setPaying] = useState<FeeRow | null>(null)
  const [student, setStudent] = useState<string | null>(null)
  const [admitting, setAdmitting] = useState(false)
  const [bulk, setBulk] = useState<{ count: number; needsTemplate: number } | null>(null)
  const estimate = useCrmMutation(() => crm.remindOverdue(true))
  const remindAll = useCrmMutation(() => crm.remindOverdue(false))
  const sum = fees.data?.summary

  return (
    <Page title={t('fees.title')}>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="md" onClick={() => setAdmitting(true)}>
          <UserPlusIcon aria-hidden />
          {t('fees.admitWalkIn')}
        </Button>
        <Button
          variant="secondary"
          size="md"
          loading={estimate.isPending}
          onClick={() =>
            estimate.mutate(undefined, {
              onSuccess: (r) =>
                setBulk({ count: r.count ?? 0, needsTemplate: r.needsTemplate ?? 0 }),
              onError: (err) =>
                toast({ title: errorText(err, t('common.failed')), tone: 'danger' }),
            })
          }
        >
          <BellRingingIcon aria-hidden />
          {t('fees.remindAll')}
        </Button>
      </div>
      {org.data && !org.data.paymentsConnected && (
        <p className="mt-3 text-small text-ink-muted">{t('fees.connectFirst')}</p>
      )}

      <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {(
          [
            ['dueThisMonth', sum?.dueThisMonthPaise, 'attention'],
            ['collected', sum?.collectedThisMonthPaise, 'success'],
            ['overdue', sum?.overduePaise, 'danger'],
          ] as const
        ).map(([key, value, tone]) => (
          <div key={key} className="rounded-card border border-rule bg-surface p-4">
            <dt>
              <StatusPill tone={tone}>{t(`fees.${key}`)}</StatusPill>
            </dt>
            <dd className="mt-2 font-display text-h1 text-ink tabular">
              {value == null ? <Skeleton className="h-8 w-28" /> : formatPaise(value)}
            </dd>
          </div>
        ))}
      </dl>

      <Tabs
        className="mt-5"
        label={t('fees.title')}
        value={tab}
        onChange={(next) => setParams(next === 'month' ? {} : { tab: next }, { replace: true })}
        tabs={TABS.map((v) => ({ value: v, label: t(`fees.tabs.${v}`) }))}
      />
      <div role="tabpanel" className="mt-3">
        {fees.isError ? (
          <p className="text-body text-danger-600">{t('common.loadError')}</p>
        ) : fees.isPending ? (
          <ListSkeleton rows={5} />
        ) : !fees.data.fees.length ? (
          <EmptyState
            icon={CurrencyInrIcon}
            title={t('fees.emptyTitle')}
            body={t('fees.emptyBody')}
          />
        ) : (
          <ul className="divide-y divide-rule rounded-card border border-rule bg-surface">
            {fees.data.fees.map((f) => (
              <FeeLine
                key={f.id}
                fee={f}
                onPay={() => setPaying(f)}
                onStudent={() => setStudent(f.student.id)}
              />
            ))}
          </ul>
        )}
      </div>

      <MarkPaidSheet fee={paying} onClose={() => setPaying(null)} />
      <StudentSheet studentId={student} onClose={() => setStudent(null)} />
      <AdmitSheet open={admitting} onClose={() => setAdmitting(false)} />
      <ConfirmDialog
        open={!!bulk}
        onOpenChange={(o) => !o && setBulk(null)}
        title={t('fees.remindAllTitle')}
        body={
          bulk
            ? t('fees.remindAllBody', { count: bulk.count, templates: bulk.needsTemplate })
            : undefined
        }
        confirmLabel={t('fees.remind')}
        cancelLabel={t('common.cancel')}
        loading={remindAll.isPending}
        onConfirm={() =>
          remindAll.mutate(undefined, {
            onSuccess: (r) => {
              setBulk(null)
              toast({ title: t('fees.remindAllDone', { sent: r.sent ?? 0 }), tone: 'success' })
            },
            onError: (err) => toast({ title: errorText(err, t('common.failed')), tone: 'danger' }),
          })
        }
      />
    </Page>
  )
}

function FeeLine({ fee, onPay, onStudent }: { fee: FeeRow; onPay(): void; onStudent(): void }) {
  const { t } = useTranslation()
  const lang = usePreferences((s) => s.language)
  const link = useCrmMutation(crm.sendLink)
  const remind = useCrmMutation(crm.remind)
  const done = (kind: 'link' | 'remind') => ({
    onSuccess: (r: { sent: boolean; reason?: string }) =>
      toast(
        r.sent
          ? {
              title: kind === 'link' ? t('fees.linkSent') : t('fees.reminderSent'),
              tone: 'success',
            }
          : {
              title: t(`fees.notSent.${r.reason}`, { defaultValue: t('common.failed') }),
              tone: 'danger',
            },
      ),
    onError: (err: unknown) =>
      toast({ title: errorText(err, t('common.failed')), tone: 'danger' as const }),
  })
  const open = fee.status !== 'paid' && fee.status !== 'waived'
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
      <div className="min-w-0 flex-1 basis-48">
        <button
          type="button"
          onClick={onStudent}
          className="text-left text-body font-semibold text-ink underline-offset-4 hover:underline"
        >
          {fee.student.name}
        </button>
        <p className="text-small text-ink-muted">
          {[fee.courseName, fee.label].filter(Boolean).join(' · ')} ·{' '}
          {fee.status === 'paid' && fee.paidAt
            ? t('fees.paidOn', { date: feeDate(fee.paidAt.slice(0, 10), lang) })
            : t('fees.dueOn', { date: feeDate(fee.dueDate, lang) })}
          {fee.receiptNo && ` · ${fee.receiptNo}`}
        </p>
      </div>
      <span className="font-display text-h3 text-ink tabular">{formatPaise(fee.amountPaise)}</span>
      <StatusPill tone={FEE_TONE[fee.status]}>{t(`fees.status.${fee.status}`)}</StatusPill>
      {open && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="md"
            loading={link.isPending}
            onClick={() => link.mutate(fee.id, done('link'))}
          >
            <LinkSimpleIcon aria-hidden />
            {t('fees.sendLink')}
          </Button>
          <Button
            variant="ghost"
            size="md"
            loading={remind.isPending}
            onClick={() => remind.mutate(fee.id, done('remind'))}
          >
            <BellRingingIcon aria-hidden />
            {t('fees.remind')}
          </Button>
          <Button variant="ghost" size="md" onClick={onPay}>
            <MoneyIcon aria-hidden />
            {t('fees.cashReceived')}
          </Button>
        </div>
      )}
    </li>
  )
}

function MarkPaidSheet({ fee, onClose }: { fee: FeeRow | null; onClose(): void }) {
  const { t } = useTranslation()
  const pay = useCrmMutation(crm.markPaid)
  const [via, setVia] = useState<'cash' | 'upi_manual' | 'bank'>('cash')
  const [receiptNo, setReceiptNo] = useState('')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!fee) return
    pay.mutate(
      { id: fee.id, via, receiptNo: receiptNo || undefined },
      {
        onSuccess: () => {
          toast({ title: t('fees.paid'), tone: 'success' })
          setReceiptNo('')
          onClose()
        },
        onError: (err) => toast({ title: errorText(err, t('common.failed')), tone: 'danger' }),
      },
    )
  }
  return (
    <Sheet
      open={!!fee}
      onOpenChange={(o) => !o && onClose()}
      title={t('fees.markPaidTitle')}
      closeLabel={t('common.close')}
    >
      {fee && (
        <form onSubmit={submit} className="flex flex-col gap-4 px-5 pt-1 pb-8">
          <p className="text-body text-ink">
            {fee.student.name} · {fee.label} ·{' '}
            <span className="font-semibold tabular">{formatPaise(fee.amountPaise)}</span>
          </p>
          <SegmentedControl<'cash' | 'upi_manual' | 'bank'>
            legend={t('fees.via')}
            value={via}
            onChange={setVia}
            options={PAID_VIA.filter((v) => v !== 'razorpay').map((v) => ({
              value: v as 'cash',
              label: t(`fees.vias.${v}`),
            }))}
          />
          <Input
            label={t('fees.receiptNo')}
            hint={t('fees.receiptHint')}
            value={receiptNo}
            onChange={(e) => setReceiptNo(e.target.value)}
            maxLength={30}
          />
          <Button type="submit" block loading={pay.isPending}>
            {t('fees.markPaid')}
          </Button>
        </form>
      )}
    </Sheet>
  )
}

function StudentSheet({ studentId, onClose }: { studentId: string | null; onClose(): void }) {
  const { t } = useTranslation()
  const lang = usePreferences((s) => s.language)
  const student = useStudent(studentId)
  const s = student.data
  return (
    <Sheet
      open={!!studentId}
      onOpenChange={(o) => !o && onClose()}
      title={s?.name ?? t('common.loading')}
      closeLabel={t('common.close')}
    >
      <div className="flex flex-col gap-4 px-5 pt-1 pb-8">
        {!s ? (
          <Skeleton className="h-40" />
        ) : (
          <>
            <p className="text-body text-ink-muted">
              {[s.course?.shortName, s.batch?.name, formatPhone(s.contact.waId)]
                .filter(Boolean)
                .join(' · ')}
            </p>
            {s.guardian && (
              <p className="text-body text-ink">
                {t('fees.guardian')}: {s.guardian.name ?? ''} {formatPhone(s.guardian.waId)}
              </p>
            )}
            <h3 className="text-h3 text-ink">{t('fees.installments')}</h3>
            <ol className="flex flex-col gap-2 border-l-2 border-rule pl-4">
              {s.installments.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 text-body text-ink">
                    {i.label} · {feeDate(i.dueDate, lang)}
                  </span>
                  <span className="text-body font-semibold text-ink tabular">
                    {formatPaise(i.amountPaise)}
                  </span>
                  <StatusPill tone={FEE_TONE[i.status]}>{t(`fees.status.${i.status}`)}</StatusPill>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </Sheet>
  )
}

function AdmitSheet({ open, onClose }: { open: boolean; onClose(): void }) {
  const { t } = useTranslation()
  const courses = useCourses()
  const admit = useCrmMutation(crm.admitWalkIn)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [guardianPhone, setGuardianPhone] = useState('')
  const [courseId, setCourseId] = useState('')
  const [batchId, setBatchId] = useState('')
  const batches =
    courses.data?.find((c) => c.id === courseId)?.batches.filter((b) => b.active) ?? []
  const submit = (e: FormEvent) => {
    e.preventDefault()
    admit.mutate(
      {
        name,
        phone,
        courseId,
        batchId: batchId || null,
        guardianPhone: guardianPhone || undefined,
      },
      {
        onSuccess: () => {
          toast({ title: t('leads.admitted'), tone: 'success' })
          setName('')
          setPhone('')
          setGuardianPhone('')
          onClose()
        },
        onError: (err) => toast({ title: errorText(err, t('common.failed')), tone: 'danger' }),
      },
    )
  }
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t('fees.admitWalkIn')}
      closeLabel={t('common.close')}
    >
      <form onSubmit={submit} className="flex flex-col gap-4 px-5 pt-1 pb-8">
        <Input
          label={t('leads.studentName')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={80}
        />
        <Input
          label={t('fees.phone')}
          type="tel"
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
          placeholder="98290 12345"
        />
        <Input
          label={t('fees.guardianPhone')}
          type="tel"
          inputMode="tel"
          value={guardianPhone}
          onChange={(e) => setGuardianPhone(e.target.value)}
        />
        <Select
          label={t('leads.course')}
          value={courseId}
          onChange={(e) => setCourseId(e.target.value)}
          required
        >
          <option value="">—</option>
          {courses.data
            ?.filter((c) => c.active)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.shortName}
              </option>
            ))}
        </Select>
        <Select
          label={t('leads.batch')}
          value={batchId}
          onChange={(e) => setBatchId(e.target.value)}
        >
          <option value="">{t('leads.noBatch')}</option>
          {batches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
        <Button type="submit" block loading={admit.isPending}>
          {t('leads.admit')}
        </Button>
      </form>
    </Sheet>
  )
}
