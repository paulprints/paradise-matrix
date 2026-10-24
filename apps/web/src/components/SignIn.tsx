import { useState } from 'react';
import type { User } from '@paradise/contract';
import { api } from '../api.ts';

/** The favicon's 3×3 dot matrix; `ring` (0 centre, 1 edges, 2 corners) staggers the settle animation. */
const DOTS = [9, 16, 23].flatMap((cy, y) => [9, 16, 23].map((cx, x) => {
  const ring = Math.abs(x - 1) + Math.abs(y - 1);
  return { cx, cy, ring, r: ring === 0 ? 3.4 : ring === 1 ? 2.4 : 1.6 };
}));

export function SignIn({ onSignedIn, notice, sharing = false }: { onSignedIn: (u: User) => void; notice?: string | null; sharing?: boolean }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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
        <svg className="dot-mark" viewBox="4 4 24 24" width="40" height="40" aria-hidden="true">
          {DOTS.map((d) => <circle key={`${d.cx},${d.cy}`} cx={d.cx} cy={d.cy} r={d.r} style={{ ['--ring' as string]: d.ring }} />)}
          <rect x="4" y="15.4" width="24" height="1.2" />
        </svg>
        <div className="wordmark">Paradise<span>Matrix</span></div>
        <div className="halftone-rule" aria-hidden="true" />
        <p className="dim" style={{ margin: 0 }}>
          {sharing ? 'Sign in with your Printers Paradise member account to open the shared chart you were sent.' : 'Sign in with your Printers Paradise member account.'}
        </p>
        {notice && <p className="warn">{notice}</p>}
        <label>Username<input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus /></label>
        <div className="signin-field">
          <label htmlFor="signin-password">Password</label>
          <div className="pw">
            <input id="signin-password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <button type="button" className="btn quiet" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-controls="signin-password" onClick={() => setShowPassword((s) => !s)}>
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>
        {error && <p className="warn" role="alert">{error}</p>}
        <button className="btn primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="note">No account? Ask your Printers Paradise admin.</p>
      </form>
    </main>
  );
}
