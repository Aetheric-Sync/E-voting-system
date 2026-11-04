'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode } from 'react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/hooks';
import type { Role } from '@/lib/types';
import { Loading } from './ui';

interface NavItem {
  href: string;
  label: string;
}

/** Public pages: header with links, no session needed. */
export function PublicShell({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <>
      <Header nav={[{ href: '/vote', label: 'Vote' }, { href: '/results', label: 'Results' }, { href: '/verify', label: 'Check a receipt' }, { href: '/staff', label: 'Staff' }]} />
      <main className={`page ${wide ? '' : 'mid'}`}>{children}</main>
    </>
  );
}

/** Signed-in pages: resolves the session, redirects to `login` when missing or the wrong role. */
export function Shell({ allow, login, nav, children }: { allow: Role[]; login: string; nav: NavItem[]; children: ReactNode }) {
  const router = useRouter();
  const me = useSession(allow, login);
  if (!me)
    return (
      <>
        <Header nav={[]} />
        <main className="page">
          <Loading label="Checking your sign-in…" />
        </main>
      </>
    );
  const signOut = async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      router.replace(login);
    }
  };
  return (
    <>
      <Header nav={nav} who={`${me.name} · ${me.role.toLowerCase()}`} onSignOut={signOut} />
      <main className="page">{children}</main>
    </>
  );
}

/** The longest nav href that matches wins, so /admin does not light up on /admin/users. */
function isActive(path: string, href: string, nav: NavItem[]) {
  const match = (h: string) => path === h || path.startsWith(h + '/');
  if (!match(href)) return false;
  return !nav.some((o) => o.href.length > href.length && match(o.href));
}

function Header({ nav, who, onSignOut }: { nav: NavItem[]; who?: string; onSignOut?: () => void }) {
  const path = usePathname();
  return (
    <header className="header">
      <div className="header-inner">
        <Link href="/" className="brand">
          E-Voting
        </Link>
        <nav className="nav" aria-label="Main">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} aria-current={isActive(path, n.href, nav) ? 'page' : undefined}>
              {n.label}
            </Link>
          ))}
        </nav>
        {who && <span className="who">{who}</span>}
        {onSignOut && (
          <button className="btn sm" onClick={onSignOut}>
            Sign out
          </button>
        )}
      </div>
    </header>
  );
}
