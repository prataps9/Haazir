import { ChatsCircleIcon } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'
import { EmptyState } from '@/components/EmptyState'
import { Sheet } from '@/components/Sheet'
import { cn } from '@/lib/cn'
import { useMe } from '@/lib/session'
import { ContactPanel } from './ContactPanel'
import { ConversationList } from './ConversationList'
import { ConversationView } from './ConversationView'
import { useConversation } from './queries'

/**
 * The inbox (spec §15, §16.4). Phones: the list, then a full-screen chat.
 * Laptops: list 320px + chat. Wide screens: plus the contact panel (320px).
 */
export default function ChatPage() {
  const { t } = useTranslation()
  const { id } = useParams()
  const { org } = useMe()
  const [contactOpen, setContactOpen] = useState(false)
  const conversation = useConversation(id)

  useEffect(() => {
    document.title = `${t('chat.title')} | Haazir`
  }, [t])
  useEffect(() => setContactOpen(false), [id])

  if (!org) return null
  const contactId = conversation.data?.contact.id

  return (
    <div
      className={cn(
        'grid h-[calc(100dvh-3.5rem-4rem-env(safe-area-inset-bottom))] min-h-0 lg:h-dvh lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)_320px]',
        id && 'h-dvh',
      )}
    >
      <section
        aria-label={t('chat.title')}
        className={cn('min-h-0 border-r border-rule bg-surface', id && 'hidden lg:block')}
      >
        <ConversationList orgId={org.id} activeId={id} />
      </section>

      <section className={cn('min-h-0', !id && 'hidden lg:block')}>
        {id ? (
          <ConversationView id={id} onShowContact={() => setContactOpen(true)} />
        ) : (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              icon={ChatsCircleIcon}
              title={t('chat.pickTitle')}
              body={t('chat.pickBody')}
            />
          </div>
        )}
      </section>

      {id && contactId && (
        <aside
          aria-label={t('chat.contactDetails')}
          className="hidden min-h-0 overflow-y-auto border-l border-rule bg-surface xl:block"
        >
          <ContactPanel contactId={contactId} />
        </aside>
      )}

      {contactId && (
        <Sheet
          open={contactOpen}
          onOpenChange={setContactOpen}
          title={t('chat.contactDetails')}
          closeLabel={t('common.close')}
        >
          <ContactPanel contactId={contactId} />
        </Sheet>
      )}
    </div>
  )
}
