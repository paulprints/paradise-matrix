import { useState } from 'react';
import type { User } from '@paradise/contract';
import { api } from '../api.ts';

export function SignIn({ onSignedIn, notice }: { onSignedIn: (u: User) => void; notice?: string | null }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <main className="signin">
      <form onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true); setError(null);
        try { onSignedIn(await api.login(username, password)); }
        catch (err) { setError((err as Error).message); }
        finally { setBusy(false); }
      }}>
        <div className="wordmark">Paradise<span>Matrix</span></div>
        <div className="halftone-rule" aria-hidden="true" />
        <p className="dim" style={{ margin: 0 }}>Sign in with your Printers Paradise member account.</p>
        {notice && <p className="warn">{notice}</p>}
        <label>Username<input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus /></label>
        <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        {error && <p className="warn" role="alert">{error}</p>}
        <button className="btn primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </main>
  );
}
