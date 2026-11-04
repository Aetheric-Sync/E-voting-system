import { ReactNode } from 'react';
import { Shell } from '@/components/Shell';

export default function ObserverLayout({ children }: { children: ReactNode }) {
  return (
    <Shell allow={['OBSERVER', 'ADMIN']} login="/staff" nav={[{ href: '/observer', label: 'Elections' }]}>
      {children}
    </Shell>
  );
}
