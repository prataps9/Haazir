import { create } from 'zustand'

export interface ToastItem {
  id: number
  title: string
  body?: string
  href?: string
  tone?: 'success' | 'danger' | 'human' | 'neutral'
}

export const useToasts = create<{ items: ToastItem[]; dismiss(id: number): void }>()((set) => ({
  items: [],
  dismiss: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
}))

let next = 1
/** "Bot ne seekh liya", "Demo book ho gayi": short confirmations of what just happened. */
export function toast(item: Omit<ToastItem, 'id'>, ms = 5000) {
  const id = next++
  useToasts.setState((s) => ({ items: [...s.items.slice(-2), { ...item, id }] }))
  setTimeout(() => useToasts.getState().dismiss(id), ms)
}
