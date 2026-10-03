import { BellIcon, DotsThreeCircleIcon, ShieldCheckIcon, SignOutIcon } from '@phosphor-icons/react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, NavLink, Outlet, useLocation, useMatch } from 'react-router'
import { LogoMark, Wordmark } from '@/components/Jharokha'
import { LanguageToggle, ThemeToggle } from '@/components/LanguageToggle'
import { Sheet } from '@/components/Sheet'
import { Toaster } from '@/components/Toaster'
import { cn } from '@/lib/cn'
import { useLogout, useMe } from '@/lib/session'
import { useSession } from '@/lib/session-store'
import { useOrgSocket } from '@/lib/socket'
import { MORE_NAV, PRIMARY_NAV, type NavItem } from './nav'

/**
 * Phones and tablets (< 1024px): top bar + five bottom tabs, with "Aur" opening
 * a sheet. Desktop: a 240px sidebar with the same groups (§15). An open chat
 * on a phone gets the whole screen, like WhatsApp itself.
 */
export function AppShell() {
  const { t } = useTranslation()
  const { org } = useMe()
  const inChat = !!useMatch('/chat/:id')
  const onChat = !!useMatch('/chat/*')
  const labels = useMemo(
    () => ({ handoff: (name: string) => t('chat.handoffToast', { name }) }),
    [t],
  )
  useOrgSocket(org?.id, labels)

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[240px_minmax(0,1fr)]">
      <Sidebar />
      <div className="flex min-h-dvh min-w-0 flex-col">
        {!inChat && <TopBar />}
        <main
          id="main"
          className={cn(
            'flex-1 lg:pb-0',
            !onChat && 'pb-[calc(4.5rem+env(safe-area-inset-bottom))]',
          )}
        >
          <Outlet />
        </main>
        {!inChat && <BottomTabs />}
      </div>
      <Toaster closeLabel={t('common.close')} />
    </div>
  )
}

function OrgName({ className }: { className?: string }) {
  const { org } = useMe()
  return (
    <span className={cn('flex min-w-0 items-center gap-2.5', className)}>
      <LogoMark />
      <span className="truncate font-display-tight text-h3 text-ink">
        {org?.displayName ?? 'Haazir'}
      </span>
    </span>
  )
}

function Bell() {
  const { t } = useTranslation()
  return (
    <Link
      to="/settings#notifications"
      aria-label={t('shell.notifications')}
      title={t('shell.notifications')}
      className="flex size-11 items-center justify-center rounded-control text-ink hover:bg-ink/5"
    >
      <BellIcon className="size-6" aria-hidden />
    </Link>
  )
}

function TopBar() {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b border-rule bg-paper pr-2 pl-4 lg:hidden">
      <OrgName />
      <Bell />
    </header>
  )
}

/** Account actions: switch org (if several), admin (super admin), log out. */
function AccountActions() {
  const { t } = useTranslation()
  const { me, org } = useMe()
  const setOrgId = useSession((s) => s.setOrgId)
  const logout = useLogout()
  if (!me) return null
  return (
    <div className="flex flex-col gap-3">
      {me.orgs.length > 1 && (
        <label className="flex flex-col gap-1.5">
          <span className="text-small font-semibold text-ink">{t('auth.org')}</span>
          <select
            value={org?.id}
            onChange={(e) => {
              setOrgId(e.target.value)
              window.location.assign('/')
            }}
            className="h-11 rounded-control border border-rule bg-surface px-3 text-body text-ink"
          >
            {me.orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.displayName}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="text-small text-ink-muted">
        {me.user.name}
        {org ? `, ${t(`auth.roles.${org.role}`)}` : ''}
      </p>
      <button
        type="button"
        onClick={() => void logout()}
        className="flex h-11 items-center gap-2 rounded-control px-2 text-body text-ink hover:bg-ink/5"
      >
        <SignOutIcon className="size-5" aria-hidden />
        {t('auth.logout')}
      </button>
    </div>
  )
}

const sep =
  'relative mt-1 pt-1 before:absolute before:inset-x-5 before:top-0 before:h-px before:bg-rule'

function Sidebar() {
  const { t } = useTranslation()
  const { me } = useMe()
  return (
    <aside className="sticky top-0 hidden h-dvh flex-col border-r border-rule bg-surface lg:flex">
      <div className="flex h-16 items-center justify-between gap-1 pr-2 pl-5">
        <OrgName />
        <Bell />
      </div>
      <nav aria-label={t('nav.main')} className="flex-1 overflow-y-auto pb-4">
        {[PRIMARY_NAV, ...MORE_NAV].map((group, i) => (
          <ul key={i} className={cn('py-1', i > 0 && sep)}>
            {group.map((item) => (
              <li key={item.to}>
                <SidebarLink item={item} />
              </li>
            ))}
          </ul>
        ))}
      </nav>
      {/* Pinned, not in the scrolling list: on a short screen it would hide under the footer. */}
      {me?.user.isSuperAdmin && (
        <div className="border-t border-rule py-1">
          <SidebarLink item={{ to: '/admin', key: 'admin', icon: ShieldCheckIcon }} />
        </div>
      )}
      <div className="flex flex-col gap-4 border-t border-rule p-5">
        <LanguageToggle />
        <AccountActions />
      </div>
    </aside>
  )
}

function SidebarLink({ item }: { item: NavItem }) {
  const { t } = useTranslation()
  const Glyph = item.icon
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      className={({ isActive }) =>
        cn(
          'relative flex h-11 items-center gap-3 px-5 text-body transition-colors duration-150',
          isActive
            ? 'bg-madder-50 font-semibold text-madder-700'
            : 'text-ink-muted hover:bg-ink/5 hover:text-ink',
        )
      }
    >
      {({ isActive }) => (
        <>
          {/* The madder binding strip marks where you are (§14.5). */}
          {isActive && <span className="absolute inset-y-0 left-0 w-1 bg-madder-700" aria-hidden />}
          <Glyph className="size-6 shrink-0" weight={isActive ? 'fill' : 'regular'} aria-hidden />
          {t(`nav.${item.key}`)}
        </>
      )}
    </NavLink>
  )
}

function BottomTabs() {
  const { t } = useTranslation()
  const { me } = useMe()
  const { pathname } = useLocation()
  const [moreOpen, setMoreOpen] = useState(false)
  const inMore = [...MORE_NAV.flat(), { to: '/admin' }].some((item) => pathname.startsWith(item.to))

  return (
    <>
      <nav
        aria-label={t('nav.main')}
        className="fixed inset-x-0 bottom-0 z-30 border-t border-rule bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        <ul className="grid h-16 grid-cols-5">
          {PRIMARY_NAV.map((item) => (
            <li key={item.to}>
              <NavLink to={item.to} end={item.to === '/'} className={tabClass}>
                {({ isActive }) => <TabContent item={item} active={isActive} />}
              </NavLink>
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-haspopup="dialog"
              className={tabClass({ isActive: inMore })}
            >
              <DotsThreeCircleIcon
                className="size-6"
                weight={inMore ? 'fill' : 'regular'}
                aria-hidden
              />
              {t('nav.more')}
            </button>
          </li>
        </ul>
      </nav>

      <Sheet
        open={moreOpen}
        onOpenChange={setMoreOpen}
        title={t('shell.moreTitle')}
        closeLabel={t('shell.close')}
      >
        <nav aria-label={t('shell.moreTitle')}>
          {[
            ...MORE_NAV,
            ...(me?.user.isSuperAdmin
              ? [[{ to: '/admin', key: 'admin', icon: ShieldCheckIcon }]]
              : []),
          ].map((group, i) => (
            <ul key={i} className={cn('py-1', i > 0 && sep)}>
              {group.map((item) => (
                <li key={item.to}>
                  <MoreLink item={item} onNavigate={() => setMoreOpen(false)} />
                </li>
              ))}
            </ul>
          ))}
        </nav>
        <div className="flex flex-col gap-4 border-t border-rule p-5">
          <LanguageToggle />
          <ThemeToggle />
          <AccountActions />
        </div>
      </Sheet>
    </>
  )
}

function tabClass({ isActive }: { isActive: boolean }) {
  return cn(
    'flex h-full w-full flex-col items-center justify-center gap-0.5 text-small transition-colors duration-150',
    isActive ? 'font-semibold text-madder-700' : 'text-ink-muted',
  )
}

function TabContent({ item, active }: { item: NavItem; active: boolean }) {
  const { t } = useTranslation()
  const Glyph = item.icon
  return (
    <>
      <Glyph className="size-6" weight={active ? 'fill' : 'regular'} aria-hidden />
      {t(`nav.${item.key}`)}
    </>
  )
}

function MoreLink({ item, onNavigate }: { item: NavItem; onNavigate(): void }) {
  const { t } = useTranslation()
  const Glyph = item.icon
  return (
    <NavLink
      to={item.to}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'relative flex h-13 items-center gap-3 px-5 text-body',
          isActive ? 'bg-madder-50 font-semibold text-madder-700' : 'text-ink',
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && <span className="absolute inset-y-0 left-0 w-1 bg-madder-700" aria-hidden />}
          <Glyph className="size-6 shrink-0" weight={isActive ? 'fill' : 'regular'} aria-hidden />
          {t(`nav.${item.key}`)}
        </>
      )}
    </NavLink>
  )
}

export { Wordmark }
