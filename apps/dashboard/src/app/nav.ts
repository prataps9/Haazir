import {
  ChalkboardTeacherIcon,
  ChartBarIcon,
  ChatsCircleIcon,
  CurrencyInrIcon,
  GearSixIcon,
  GraduationCapIcon,
  MegaphoneIcon,
  NotebookIcon,
  ReceiptIcon,
  RobotIcon,
  CardsIcon,
  UsersIcon,
  UsersThreeIcon,
  type Icon,
} from '@phosphor-icons/react'
import type { Role } from '@haazir/shared'

export interface NavItem {
  to: string
  /** Key under `nav.` in the locale files. */
  key: string
  icon: Icon
  /** Only these roles see it (spec §19: agents have no campaigns, templates or reports). */
  roles?: Role[]
}

const MANAGERS: Role[] = ['owner', 'admin']

/** The nav groups a role sees. */
export function navFor(role: Role | undefined, groups: NavItem[][]) {
  return groups
    .map((g) => g.filter((item) => !item.roles || (role && item.roles.includes(role))))
    .filter((g) => g.length)
}

/** The four daily screens: bottom tabs on phones (plus "Aur"), first group in the sidebar (§15). */
export const PRIMARY_NAV: NavItem[] = [
  { to: '/', key: 'home', icon: NotebookIcon },
  { to: '/chat', key: 'chat', icon: ChatsCircleIcon },
  { to: '/leads', key: 'leads', icon: UsersThreeIcon },
  { to: '/fees', key: 'fees', icon: CurrencyInrIcon },
]

/** Everything behind "Aur": set-up and teaching, then running the business. */
export const MORE_NAV: NavItem[][] = [
  [
    { to: '/courses', key: 'courses', icon: GraduationCapIcon },
    { to: '/campaigns', key: 'campaigns', icon: MegaphoneIcon, roles: MANAGERS },
    { to: '/templates', key: 'templates', icon: CardsIcon, roles: MANAGERS },
    { to: '/knowledge', key: 'knowledge', icon: ChalkboardTeacherIcon },
    { to: '/bot', key: 'bot', icon: RobotIcon },
  ],
  [
    { to: '/reports', key: 'reports', icon: ChartBarIcon, roles: MANAGERS },
    { to: '/team', key: 'team', icon: UsersIcon },
    { to: '/billing', key: 'billing', icon: ReceiptIcon },
    { to: '/settings', key: 'settings', icon: GearSixIcon },
  ],
]

export const ALL_NAV = [PRIMARY_NAV, ...MORE_NAV].flat()
