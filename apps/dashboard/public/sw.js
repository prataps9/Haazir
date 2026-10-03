// Haazir service worker: only push notifications, no offline caching (yet).
// A handoff push says who needs the team; tapping it opens that chat.

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: 'Haazir', body: event.data ? event.data.text() : '' }
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Haazir', {
      body: data.body || '',
      tag: data.tag,
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      data: { url: data.url || '/chat' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL(event.notification.data?.url || '/chat', self.location.origin).href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      // Reuse an open Haazir tab: move it to the chat instead of opening another.
      for (const w of windows) {
        if (new URL(w.url).origin === self.location.origin && 'focus' in w) {
          return w.focus().then((c) => ('navigate' in c ? c.navigate(target) : c))
        }
      }
      return self.clients.openWindow(target)
    }),
  )
})
