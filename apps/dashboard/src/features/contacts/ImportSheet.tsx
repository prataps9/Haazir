import { FileCsvIcon } from '@phosphor-icons/react'
import { useState, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { Input } from '@/components/Input'
import { Sheet } from '@/components/Sheet'
import { Switch } from '@/components/Switch'
import {
  parseCsv,
  rowsFromCsv,
  useImportContacts,
  type ImportResult,
  type ImportRow,
} from '@/lib/contacts'
import { errorText } from '@/lib/errors'

const MAX_ROWS = 2000

/**
 * Bring in a list the institute already has. The file is read in the browser
 * and only the rows are sent.
 *
 * Consent (spec §19): people from a list are left out of campaigns unless the
 * file has a consent column AND the person uploading declares they hold that
 * consent. The switch for that only appears when the column is there.
 */
export function ImportSheet({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange(o: boolean): void
}) {
  const { t } = useTranslation()
  const run = useImportContacts()
  const [rows, setRows] = useState<ImportRow[]>()
  const [hasConsent, setHasConsent] = useState(false)
  const [declared, setDeclared] = useState(false)
  const [tagText, setTagText] = useState('')
  const [error, setError] = useState<string>()
  const [result, setResult] = useState<ImportResult>()

  const reset = () => {
    setRows(undefined)
    setHasConsent(false)
    setDeclared(false)
    setTagText('')
    setError(undefined)
    setResult(undefined)
  }
  const close = (o: boolean) => {
    if (!o) reset()
    onOpenChange(o)
  }

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError(undefined)
    setResult(undefined)
    const parsed = rowsFromCsv(parseCsv(await file.text()))
    if (!parsed.rows.length) return setError(t('contacts.importEmpty'))
    if (parsed.rows.length > MAX_ROWS)
      return setError(t('contacts.importTooMany', { max: MAX_ROWS }))
    setRows(parsed.rows)
    setHasConsent(parsed.hasConsentColumn)
    setDeclared(false)
  }

  const saidYes = rows?.filter((r) => r.consent).length ?? 0
  const submit = () => {
    if (!rows) return
    run.mutate(
      {
        rows,
        consentDeclared: declared,
        tags: tagText
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      },
      {
        onSuccess: (r) => {
          setResult(r)
          setRows(undefined)
        },
        onError: (err) => setError(errorText(err, t('common.failed'))),
      },
    )
  }

  return (
    <Sheet
      open={open}
      onOpenChange={close}
      title={t('contacts.importTitle')}
      closeLabel={t('shell.close')}
    >
      <div className="flex flex-col gap-4 overflow-y-auto px-5 pb-6">
        <p className="text-body text-ink-muted">{t('contacts.importBody')}</p>

        <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-control border border-rule px-3.5 text-body text-ink hover:border-ink-muted/60">
          <FileCsvIcon className="size-6 shrink-0 text-madder-700" aria-hidden />
          <span className="min-w-0 flex-1 truncate">
            {rows ? t('contacts.importRows', { count: rows.length }) : t('contacts.importChoose')}
          </span>
          <input
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(e) => void pick(e)}
          />
        </label>

        {rows && (
          <>
            <Input
              label={t('contacts.importTags')}
              hint={t('contacts.bulkHint')}
              value={tagText}
              onChange={(e) => setTagText(e.target.value)}
              maxLength={200}
            />
            {hasConsent ? (
              <div className="rounded-card border border-rule p-4">
                <p className="text-body text-ink">
                  {t('contacts.importConsentFound', { count: saidYes })}
                </p>
                <Switch
                  className="mt-2"
                  label={t('contacts.importDeclare')}
                  description={t('contacts.importDeclareHint')}
                  checked={declared}
                  onChange={setDeclared}
                />
              </div>
            ) : (
              <p className="rounded-card border border-rule p-4 text-small text-ink-muted">
                {t('contacts.importNoConsent')}
              </p>
            )}
            <Button onClick={submit} loading={run.isPending}>
              {t('contacts.importGo', { count: rows.length })}
            </Button>
          </>
        )}

        {error && (
          <p role="alert" className="text-body text-danger-600">
            {error}
          </p>
        )}

        {result && (
          <div role="status" className="rounded-card border border-rule p-4 text-body text-ink">
            <p className="font-semibold">{t('contacts.importDone')}</p>
            <ul className="mt-2 flex flex-col gap-1 text-small">
              <li>{t('contacts.importCreated', { count: result.created })}</li>
              <li>{t('contacts.importUpdated', { count: result.updated })}</li>
              <li>{t('contacts.importOptedIn', { count: result.optedIn })}</li>
              {result.invalidCount > 0 && (
                <li className="text-danger-600">
                  {t('contacts.importInvalid', {
                    count: result.invalidCount,
                    rows: result.invalid.slice(0, 10).join(', '),
                  })}
                </li>
              )}
            </ul>
          </div>
        )}
      </div>
    </Sheet>
  )
}
