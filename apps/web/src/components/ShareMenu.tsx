/** "Share" in the top bar: turn the current chart into a shared chart, and find the ones you've made. */
import { useState } from 'react';
import type { Drawing, LinkAccess, ShareInfo } from '@paradise/contract';
import { SHARE_LIMITS } from '@paradise/contract';
import { api } from '../api.ts';
import type { ViewState } from '../lib/view.ts';
import { configFromView, shareLink } from '../share/route.ts';
import { CopyLink } from './CopyLink.tsx';
import { LinkAccessPicker } from './LinkAccessPicker.tsx';
import { Popover } from './TopBar.tsx';

export function ShareMenu({ view, drawings }: { view: ViewState; drawings: Drawing[] }) {
  const [title, setTitle] = useState('');
  const [access, setAccess] = useState<LinkAccess>('viewer');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<ShareInfo | null>(null);
  const [mine, setMine] = useState<ShareInfo[] | null>(null);
  const origin = location.origin;

  const load = () => { setError(null); api.myShares().then(setMine).catch((e) => setError((e as Error).message)); };
  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const share = await api.createShare(title.trim() || `${view.symbol} ${view.chartTf}`, configFromView(view), drawings, access);
      setMade(share);
      setTitle('');
      load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const remove = async (s: ShareInfo) => {
    if (!confirm(`Delete “${s.title}”? Everyone with its links loses access.`)) return;
    try { await api.deleteShare(s.id); if (made?.id === s.id) setMade(null); load(); } catch (e) { setError((e as Error).message); }
  };

  return (
    <Popover label="Share" wide onOpen={load}>
      <div className="share-menu">
        {made ? (
          <>
            <h4>“{made.title}” is ready</h4>
            <CopyLink label="Link" note="send it to anyone in the group" url={shareLink(origin, made.id)} />
            <LinkAccessPicker value={made.linkAccess} onChange={async (v) => { try { setMade(await api.updateShare(made.id, { linkAccess: v })); } catch (e) { setError((e as Error).message); } }} />
            <p className="note">Everyone who opens it appears under <strong>People</strong> on the shared chart, where you choose who can view or edit.</p>
            <div className="row"><a className="btn primary" href={shareLink(origin, made.id)}>Open shared chart</a><button className="btn quiet" onClick={() => setMade(null)}>Share another</button></div>
          </>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); void create(); }}>
            <h4>Share this chart</h4>
            <p className="note">Makes a shared copy of this view ({view.symbol}, {view.chartTf} candles, {view.timeframes.join(' + ')} levels) with your {drawings.length} drawing{drawings.length === 1 ? '' : 's'}. Your own chart stays as it is.</p>
            <label className="field stack">
              <span className="muted">Title</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={SHARE_LIMITS.titleLength} placeholder={`${view.symbol} ${view.chartTf}`} />
            </label>
            <LinkAccessPicker value={access} onChange={setAccess} />
            <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create link'}</button>
          </form>
        )}
        {error && <p className="warn" role="alert">{error}</p>}
        <h4>Your shared charts</h4>
        {mine === null ? <p className="muted">Loading…</p> : mine.length === 0 ? <p className="muted">None yet.</p> : (
          <ul className="share-list">
            {mine.map((s) => (
              <li key={s.id}>
                <a href={shareLink(origin, s.id)} title="Open">{s.title}</a>
                <span className="muted">{s.config.symbol} · {s.config.chartTf}{s.locked ? ' · locked' : ''}</span>
                <button className="btn quiet" onClick={() => remove(s)} aria-label={`Delete ${s.title}`}>Delete</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Popover>
  );
}
