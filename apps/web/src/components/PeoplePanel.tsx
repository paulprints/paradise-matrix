/** The owner's people list for a shared chart: who opened the link, who's waiting, what each can do. */
import type { MemberRole, ShareMember } from '@paradise/contract';
import { ago } from '../lib/ago.ts';

type Settable = Exclude<MemberRole, 'pending'>;

export function PeoplePanel({ members, onSet }: { members: ShareMember[]; onSet: (userId: number, role: Settable) => void }) {
  const waiting = members.filter((m) => m.role === 'pending');
  const people = members.filter((m) => m.role === 'viewer' || m.role === 'editor')
    .sort((a, b) => Number(b.online) - Number(a.online) || a.username.localeCompare(b.username));
  const removed = members.filter((m) => m.role === 'removed');

  return (
    <div className="people">
      {waiting.length > 0 && (
        <section aria-label="Waiting to join">
          <h4>Waiting to join · {waiting.length}</h4>
          <ul>
            {waiting.map((m) => (
              <li key={m.userId} className="person waiting">
                <span className="person-name">{m.username}<span className="muted"> asked {ago(m.lastSeen)}</span></span>
                <span className="person-actions">
                  <button className="btn" onClick={() => onSet(m.userId, 'viewer')}>Let in to view</button>
                  <button className="btn" onClick={() => onSet(m.userId, 'editor')}>Let in to edit</button>
                  <button className="btn quiet" onClick={() => onSet(m.userId, 'removed')} aria-label={`Deny ${m.username}`}>Deny</button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section aria-label="People">
        <h4>People{people.length ? ` · ${people.length}` : ''}</h4>
        {people.length === 0 ? <p className="muted">Nobody else has opened the link yet.</p> : (
          <ul>
            {people.map((m) => (
              <li key={m.userId} className="person">
                <span className="person-name">
                  <i className={`presence ${m.online ? 'on' : ''}`} title={m.online ? 'Here now' : `Last here ${ago(m.lastSeen)}`} />
                  {m.username}
                  {!m.online && <span className="muted"> {ago(m.lastSeen)}</span>}
                </span>
                <select
                  value={m.role} aria-label={`What ${m.username} can do`}
                  onChange={(e) => { const r = e.target.value as Settable; if (r !== 'removed' || confirm(`Remove ${m.username}? The link stops working for them.`)) onSet(m.userId, r); }}
                >
                  <option value="viewer">Can view</option>
                  <option value="editor">Can edit</option>
                  <option value="removed">Remove</option>
                </select>
              </li>
            ))}
          </ul>
        )}
      </section>
      {removed.length > 0 && (
        <details className="removed">
          <summary className="muted">Removed · {removed.length}</summary>
          <ul>
            {removed.map((m) => (
              <li key={m.userId} className="person">
                <span className="person-name">{m.username}</span>
                <button className="btn quiet" onClick={() => onSet(m.userId, 'viewer')}>Restore (view)</button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
