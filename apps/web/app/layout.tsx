import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: { default: 'E-Voting', template: '%s · E-Voting' },
  description: 'Secure, auditable departmental elections',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
