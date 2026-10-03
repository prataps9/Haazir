import { useCallback, useEffect, useState } from 'react'
import { api, del, post } from './api'

export type PushState = 'checking' | 'unsupported' | 'not-configured' | 'denied' | 'off' | 'on'

const supported = () =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window

/** VAPID keys arrive as URL-safe base64; the browser wants bytes. */
function keyBytes(base64: string) {
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

const registration = () => navigator.serviceWorker.register('/sw.js')

/** Whether this phone gets Web Push, and the switch to turn it on or off. */
export function usePush() {
  const [state, setState] = useState<PushState>('checking')

  const refresh = useCallback(async () => {
    if (!supported()) return setState('unsupported')
    if (Notification.permission === 'denied') return setState('denied')
    const reg = await navigator.serviceWorker.getRegistration('/sw.js')
    const sub = await reg?.pushManager.getSubscription()
    setState(sub ? 'on' : 'off')
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const enable = useCallback(async () => {
    const { publicKey } = await api<{ publicKey: string | null }>('/api/v1/push/public-key')
    if (!publicKey) return setState('not-configured')
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') return setState('denied')
    const reg = await registration()
    await navigator.serviceWorker.ready
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(publicKey),
      }))
    const json = sub.toJSON()
    await post('/api/v1/push/subscribe', {
      endpoint: json.endpoint,
      keys: json.keys,
      deviceLabel: navigator.userAgent.slice(0, 60),
    })
    setState('on')
  }, [])

  const disable = useCallback(async () => {
    const reg = await navigator.serviceWorker.getRegistration('/sw.js')
    const sub = await reg?.pushManager.getSubscription()
    if (sub) {
      await del('/api/v1/push/subscribe', { endpoint: sub.endpoint }).catch(() => {})
      await sub.unsubscribe()
    }
    setState('off')
  }, [])

  return { state, enable, disable }
}
