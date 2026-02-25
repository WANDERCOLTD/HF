'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  MessageCircle,
  TrendingUp,
  Phone,
  Sparkles,
  Users,
  BarChart2,
  LayoutDashboard,
  HelpCircle,
  LogOut,
  type LucideIcon,
} from 'lucide-react';
import { useResponsive } from '@/hooks/useResponsive';
import { ROLE_LEVEL } from '@/lib/roles';
import type { UserRole } from '@prisma/client';

interface SimTab {
  id: string;
  label: string;
  icon: LucideIcon;
  href: string;
  /** Minimum role level to see this tab */
  minLevel: number;
  /** Maximum role level (inclusive). Omit for no upper bound. */
  maxLevel?: number;
  /** Pin to bottom of strip on desktop */
  pinBottom?: boolean;
}

const ALL_TABS: SimTab[] = [
  // Always visible (all roles)
  {
    id: 'chat',
    label: 'Chat',
    icon: MessageCircle,
    href: '/x/sim',
    minLevel: 0,
  },

  // DEMO only
  {
    id: 'help',
    label: 'Help',
    icon: HelpCircle,
    href: '/x/demos',
    minLevel: 0,
    maxLevel: 0,
  },

  // Student / Tester (level 1–2, not educators/admins who have their own views)
  {
    id: 'progress',
    label: 'Progress',
    icon: TrendingUp,
    href: '/x/student/progress',
    minLevel: 1,
    maxLevel: 2,
  },
  {
    id: 'calls',
    label: 'History',
    icon: Phone,
    href: '/x/student/calls',
    minLevel: 1,
    maxLevel: 2,
  },
  {
    id: 'stuff',
    label: 'My Stuff',
    icon: Sparkles,
    href: '/x/student/stuff',
    minLevel: 1,
    maxLevel: 2,
  },

  // Educator (level 3)
  {
    id: 'students',
    label: 'Students',
    icon: Users,
    href: '/x/educator/students',
    minLevel: 3,
    maxLevel: 3,
  },
  {
    id: 'reports',
    label: 'Reports',
    icon: BarChart2,
    href: '/x/educator/reports',
    minLevel: 3,
    maxLevel: 3,
  },
  {
    id: 'educator-dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    href: '/x/educator',
    minLevel: 3,
    maxLevel: 3,
    pinBottom: true,
  },

  // Admin / Operator (level 4+)
  {
    id: 'callers',
    label: 'Callers',
    icon: Users,
    href: '/x/callers',
    minLevel: 4,
  },
  {
    id: 'analytics',
    label: 'Analytics',
    icon: BarChart2,
    href: '/x/analytics',
    minLevel: 4,
  },
  {
    id: 'admin-dashboard',
    label: 'Admin',
    icon: LayoutDashboard,
    href: '/x/',
    minLevel: 4,
    pinBottom: true,
  },

  // Exit sim — all authenticated users (level 1+)
  {
    id: 'exit',
    label: 'Exit',
    icon: LogOut,
    href: '/x/',
    minLevel: 1,
    pinBottom: true,
  },
];

function getRoleLevel(role: string | undefined | null): number {
  if (!role) return -1;
  return ROLE_LEVEL[role as UserRole] ?? -1;
}

function getTabsForRole(roleLevel: number): { main: SimTab[]; bottom: SimTab[] } {
  const visible = ALL_TABS.filter((tab) => {
    if (roleLevel < tab.minLevel) return false;
    if (tab.maxLevel !== undefined && roleLevel > tab.maxLevel) return false;
    return true;
  });

  return {
    main: visible.filter((t) => !t.pinBottom),
    bottom: visible.filter((t) => t.pinBottom),
  };
}

// ─────────────────────────────────────────────
// Desktop: vertical icon strip on the far left
// ─────────────────────────────────────────────
function NavStrip({ tabs }: { tabs: { main: SimTab[]; bottom: SimTab[] } }) {
  const pathname = usePathname();

  const renderItem = (tab: SimTab) => {
    const Icon = tab.icon;
    const isActive = tab.id === 'chat'
      ? pathname.startsWith('/x/sim')
      : pathname.startsWith(tab.href);

    return (
      <Link
        key={tab.id}
        href={tab.href}
        className={`wa-nav-strip-item${isActive ? ' active' : ''}`}
        data-label={tab.label}
        aria-label={tab.label}
      >
        <Icon size={20} strokeWidth={1.75} />
      </Link>
    );
  };

  return (
    <nav className="wa-nav-strip">
      {tabs.main.map(renderItem)}
      <div className="wa-nav-strip-spacer" />
      {tabs.bottom.map(renderItem)}
    </nav>
  );
}

// ─────────────────────────────────────────────
// Mobile/Tablet: bottom tab bar
// ─────────────────────────────────────────────
function NavBar({ tabs }: { tabs: { main: SimTab[]; bottom: SimTab[] } }) {
  const pathname = usePathname();
  // Flatten main + bottom for the bar (max 5 shown)
  const allTabs = [...tabs.main, ...tabs.bottom].slice(0, 5);

  return (
    <nav className="wa-nav-bar">
      {allTabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = tab.id === 'chat'
          ? pathname.startsWith('/x/sim')
          : pathname.startsWith(tab.href);

        return (
          <Link
            key={tab.id}
            href={tab.href}
            className={`wa-nav-bar-item${isActive ? ' active' : ''}`}
            aria-label={tab.label}
          >
            <Icon size={22} strokeWidth={tab.id === 'chat' && isActive ? 2.5 : 1.75} />
            <span className="wa-nav-bar-label">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

// ─────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────
export function SimNavBar() {
  const { data: session } = useSession();
  const { isDesktop } = useResponsive();
  const roleLevel = getRoleLevel(session?.user?.role as string);

  // Not logged in — no nav
  if (roleLevel < 0) return null;

  const tabs = getTabsForRole(roleLevel);

  // Only show nav if there are meaningful tabs beyond just "Chat"
  const totalTabs = tabs.main.length + tabs.bottom.length;
  if (totalTabs <= 1) return null;

  if (isDesktop) return <NavStrip tabs={tabs} />;
  return <NavBar tabs={tabs} />;
}
