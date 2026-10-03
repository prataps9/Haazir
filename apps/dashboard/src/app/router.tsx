import { createBrowserRouter, type RouteObject } from 'react-router'
import { AppShell } from './AppShell'
import { MORE_NAV, PRIMARY_NAV } from './nav'
import { RequireAuth } from './RequireAuth'

// Every screen is its own chunk (§14.11: < 250 KB gzip on first load), so a
// phone opening the inbox never downloads the campaign builder.
const placeholder =
  (navKey: string): RouteObject['lazy'] =>
  async () => {
    const { PlaceholderPage } = await import('@/features/placeholder/PlaceholderPage')
    return { Component: () => <PlaceholderPage navKey={navKey} /> }
  }

const screens: RouteObject[] = [
  {
    index: true,
    lazy: async () => ({ Component: (await import('@/features/home/HomePage')).default }),
  },
  {
    path: 'chat',
    lazy: async () => ({ Component: (await import('@/features/chat/ChatPage')).default }),
  },
  {
    path: 'chat/:id',
    lazy: async () => ({ Component: (await import('@/features/chat/ChatPage')).default }),
  },
  {
    path: 'knowledge',
    lazy: async () => ({ Component: (await import('@/features/knowledge/KnowledgePage')).default }),
  },
  {
    path: 'bot',
    lazy: async () => ({ Component: (await import('@/features/bot/BotSettingsPage')).default }),
  },
  {
    path: 'admin',
    lazy: async () => ({ Component: (await import('@/features/admin/AdminPage')).default }),
  },
  {
    path: 'settings',
    lazy: async () => ({ Component: (await import('@/features/settings/SettingsPage')).default }),
  },
  // Screens later phases build; each replaces its placeholder.
  ...[...PRIMARY_NAV.slice(1), ...MORE_NAV.flat()]
    .filter((item) => !['settings', 'chat', 'knowledge', 'bot'].includes(item.key))
    .map((item) => ({
      path: item.to.slice(1),
      lazy: placeholder(item.key),
    })),
  {
    path: '*',
    lazy: async () => ({
      Component: (await import('@/features/placeholder/NotFoundPage')).default,
    }),
  },
]

const routes: RouteObject[] = [
  {
    path: '/login',
    hydrateFallbackElement: <ShellFallback />,
    lazy: async () => ({ Component: (await import('@/features/auth/LoginPage')).default }),
  },
  {
    path: '/invite/:token',
    hydrateFallbackElement: <ShellFallback />,
    lazy: async () => ({ Component: (await import('@/features/auth/InvitePage')).default }),
  },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    hydrateFallbackElement: <ShellFallback />,
    children: screens,
  },
]

// The component gallery ships in development builds only (§14.9).
if (import.meta.env.DEV) {
  routes.unshift({
    path: '/dev/components',
    hydrateFallbackElement: <ShellFallback />,
    lazy: async () => ({ Component: (await import('@/features/dev/ComponentsPage')).default }),
  })
}

export const router = createBrowserRouter(routes)

/** Shown for the split second before the first screen's chunk arrives. */
function ShellFallback() {
  return <div className="min-h-dvh bg-paper" aria-busy="true" />
}
