'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';

type Role = 'SUPER_ADMIN' | 'AGENT' | 'USER';

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  /** 允许访问的最小角色 */
  minRole: Role;
}

const NAV_ITEMS: NavItem[] = [
  {
    href: '/',
    label: '仪表盘',
    minRole: 'USER',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <rect x="3" y="3" width="7" height="9" rx="1.5" />
        <rect x="14" y="3" width="7" height="5" rx="1.5" />
        <rect x="14" y="12" width="7" height="9" rx="1.5" />
        <rect x="3" y="16" width="7" height="5" rx="1.5" />
      </svg>
    ),
  },
  {
    href: '/programs',
    label: '程序管理',
    minRole: 'SUPER_ADMIN',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <polyline points="16 18 22 12 16 6" />
        <polyline points="8 6 2 12 8 18" />
      </svg>
    ),
  },
  {
    href: '/users',
    label: '用户管理',
    minRole: 'AGENT',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    href: '/admin-users',
    label: '后台管理',
    minRole: 'SUPER_ADMIN',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        <circle cx="12" cy="16" r="1" />
      </svg>
    ),
  },
  {
    href: '/invitations',
    label: '邀请码',
    minRole: 'SUPER_ADMIN',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <path d="M4 4h16v16H4z" />
        <path d="M4 12h16" />
        <path d="M12 4v16" />
      </svg>
    ),
  },
];

const ROLE_LEVEL: Record<Role, number> = {
  USER: 0,
  AGENT: 1,
  SUPER_ADMIN: 2,
};

function canSee(role: Role, minRole: Role): boolean {
  return ROLE_LEVEL[role] >= ROLE_LEVEL[minRole];
}

export default function BottomIsland({ role }: { role: Role }) {
  const pathname = usePathname();
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);

  function isActive(href: string) {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  }

  const visibleItems = NAV_ITEMS.filter(item => canSee(role, item.minRole));

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
      <div
        className="glass island-enter rounded-full shadow-2xl transition-all duration-300 ease-out"
        style={{
          padding: '8px',
          borderRadius: '28px',
        }}
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => setExpanded(false)}
      >
        <nav className="flex items-center gap-1">
          {visibleItems.map(item => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2 h-12 rounded-full transition-all duration-200 ${
                  active
                    ? 'bg-[var(--brand)] text-[var(--bg)] px-5 font-semibold'
                    : 'text-[var(--text)] hover:bg-[var(--surface-2)] px-3'
                } ${expanded ? 'pr-5' : ''}`}
                style={{ minWidth: expanded ? 'auto' : '48px' }}
              >
                <span className="flex-shrink-0 flex items-center justify-center w-6">
                  {item.icon}
                </span>
                <span
                  className={`text-sm whitespace-nowrap transition-all duration-200 ${
                    expanded || active ? 'opacity-100' : 'opacity-0 w-0 overflow-hidden'
                  }`}
                >
                  {item.label}
                </span>
              </Link>
            );
          })}

          <button
            onClick={handleLogout}
            className="flex items-center justify-center w-12 h-12 rounded-full text-[var(--text-muted)] hover:text-red-500 hover:bg-red-500/10 transition"
            title="退出登录"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </nav>
      </div>
    </div>
  );
}
