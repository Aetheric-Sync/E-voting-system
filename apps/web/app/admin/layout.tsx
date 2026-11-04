import { ReactNode } from 'react';
import { Shell } from '@/components/Shell';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <Shell
      allow={['ADMIN']}
      login="/staff"
      nav={[
        { href: '/admin', label: 'Elections' },
        { href: '/admin/elections/new', label: 'New election' },
        { href: '/admin/users', label: 'Staff' },
      ]}
    >
      {children}
    </Shell>
  );
}
