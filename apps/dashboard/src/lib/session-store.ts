import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** Which organisation the dashboard is acting for (sent as X-Org-Id). Per device. */
export const useSession = create<{ orgId: string | null; setOrgId(id: string | null): void }>()(
  persist((set) => ({ orgId: null, setOrgId: (orgId) => set({ orgId }) }), { name: 'haazir-org' }),
)
