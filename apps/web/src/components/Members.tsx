import { useEffect, useState } from 'react';
import type { User } from '@paradise/contract';
import { api } from '../api.ts';

type Member = User & { createdAt: string };

export function Members({ me, onBack }: { me: User; onBack: () => void }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [history, setHistory] = useState<Array<Record<string, any>>>([]);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [form, setForm] = useState({ username: '', password: '', isAdmin: false });

  const load = async () => {
    try { setMembers(await api.users()); setHistory(await api.loginHistory(30)); }
    catch (e) { setMsg({ text: (e as Error).message, error: true }); }
  };
  useEffect(() => { load(); }, []);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); setMsg({ text: ok }); await load(); }
    catch (e) { setMsg({ text: (e as Error).message, error: true }); }
  };

  return (
    <main className="admin">
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <button className="btn" onClick={onBack}>Back to matrix</button>
        <h1 style={{ margin: 0, fontSize: 'var(--step-2)' }}>Members</h1>
      </div>
      {msg && <p className={msg.error ? 'warn' : 'note'} role="status">{msg.text}</p>}

      <section>
        <h2>Add a member</h2>
        <form onSubmit={(e) => { e.preventDefault(); act(() => api.createUser(form.username, form.password, form.isAdmin), `Added ${form.username}`).then(() => setForm({ username: '', password: '', isAdmin: false })); }}>
          <label>Username<input type="text" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required minLength={3} /></label>
          <label>Temporary password<input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} autoComplete="new-password" /></label>
          <label className="toggle" style={{ display: 'flex' }}><input type="checkbox" checked={form.isAdmin} onChange={(e) => setForm({ ...form, isAdmin: e.target.checked })} />Admin</label>
          <button className="btn primary">Add member</button>
        </form>
      </section>

      <section>
        <h2>All members</h2>
        <table>
          <thead><tr><th>Username</th><th>Role</th><th>Added</th><th /></tr></thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id}>
                <td>{m.username}{m.id === me.id ? ' (you)' : ''}</td>
                <td>{m.isAdmin ? 'Admin' : 'Member'}</td>
                <td className="num">{m.createdAt?.slice(0, 10)}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {m.id !== me.id && (
                    <>
                      <button className="btn quiet" onClick={() => act(() => api.updateUser(m.id, { isAdmin: !m.isAdmin }), m.isAdmin ? `${m.username} is now a member` : `${m.username} is now an admin`)}>{m.isAdmin ? 'Make member' : 'Make admin'}</button>
                      <button className="btn quiet" onClick={() => {
                        const pw = prompt(`New password for ${m.username} (8+ characters)`);
                        if (pw) act(() => api.updateUser(m.id, { password: pw }), `Password reset for ${m.username}`);
                      }}>Reset password</button>
                      <button className="btn quiet" onClick={() => { if (confirm(`Remove ${m.username}? They’ll be signed out immediately.`)) act(() => api.deleteUser(m.id), `Removed ${m.username}`); }}>Remove</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Recent sign-ins</h2>
        <table>
          <thead><tr><th>When (UTC)</th><th>Username</th><th>Result</th><th>IP</th></tr></thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.id}><td className="num">{h.created_at}</td><td>{h.username}</td><td>{h.login_status === 'success' ? 'Signed in' : 'Failed'}</td><td className="num">{h.ip_address ?? '—'}</td></tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
