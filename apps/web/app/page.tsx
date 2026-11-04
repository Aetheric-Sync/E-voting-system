import Link from 'next/link';
import { PublicShell } from '@/components/Shell';

export default function Home() {
  return (
    <PublicShell wide>
      <div className="mid" style={{ textAlign: 'center', marginBottom: '2rem' }}>
        <h1>Departmental elections you can check</h1>
        <p className="muted">Vote from any phone. Every ballot is anonymous, every count is verifiable.</p>
      </div>
      <div className="grid cols-3">
        <Link href="/vote" className="card link">
          <h2>I&apos;m a voter</h2>
          <p className="muted">Sign in with your matric number. We send a one-time code to the email or phone on the register.</p>
          <span className="btn primary">Vote</span>
        </Link>
        <Link href="/staff" className="card link">
          <h2>I&apos;m electoral staff</h2>
          <p className="muted">Administrators run elections. Observers audit them. Sign in with your staff account.</p>
          <span className="btn">Staff sign in</span>
        </Link>
        <Link href="/results" className="card link">
          <h2>Results and receipts</h2>
          <p className="muted">Read published results, or check that your ballot receipt is in the ballot box. No sign-in needed.</p>
          <span className="btn">View results</span>
        </Link>
      </div>
    </PublicShell>
  );
}
