/** The strip on a shared chart: who's here, live status, presenting, and the owner's controls. */
import { useState } from 'react';
import type { Peer } from '@paradise/contract';
import { SHARE_LIMITS } from '@paradise/contract';
import type { ViewState } from '../lib/view.ts';
import { configFromView, shareLink } from '../share/route.ts';
import type { ShareSession } from '../share/useShare.ts';
import { CopyLink } from './CopyLink.tsx';
import { LinkAccessPicker } from './LinkAccessPicker.tsx';
import { PeoplePanel } from './PeoplePanel.tsx';
import { Popover } from './TopBar.tsx';

const ROLE: Record<string, string> = { owner: 'Owner', editor: 'Can edit', viewer: 'View only' };
const STATUS: Record<string, string> = { live: 'Live', connecting: 'Connecting…', offline: 'Reconnecting…', ended: 'Disconnected' };
const ENDED: Record<string, string> = {
  revoked: 'The owner removed your access.',
  gone: 'The owner deleted this shared chart.',
  auth: 'Your session ended. Sign in again to rejoin.',
};

function Avatar({ p, presenting, you }: { p: Peer; presenting: boolean; you?: boolean }) {
  return (
    <span className={`avatar ${presenting ? 'presenting' : ''}`} style={{ background: p.color }} title={`${p.username}${you ? ' (you)' : ''} · ${ROLE[p.role]}${presenting ? ' · presenting' : ''}`}>
      {p.username.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function ShareBar({ share, view, onExit }: { share: ShareSession; view: ViewState; onExit: () => void }) {
  const { info, you, peers } = share;
  const [renaming, setRenaming] = useState(false);
  if (!info) return null;
  const owner = share.role === 'owner';
  const origin = location.origin;
  // One avatar per member (someone may have several tabs open; each tab still shows its own cursor).
  const everyone = [...(you ? [you] : []), ...peers].filter((p, i, all) => all.findIndex((q) => q.userId === p.userId) === i);
  const presentingUser = share.presenterPeer?.userId;
  const presenterName = share.presenterPeer?.username;
  const waiting = share.members.filter((m) => m.role === 'pending').length;

  return (
    <div className="sharebar" role="region" aria-label="Shared chart">
      {renaming ? (
        <form onSubmit={(e) => { e.preventDefault(); const t = new FormData(e.currentTarget).get('t')?.toString().trim(); if (t) void share.rename(t); setRenaming(false); }}>
          <input name="t" defaultValue={info.title} maxLength={SHARE_LIMITS.titleLength} autoFocus aria-label="Title" onBlur={() => setRenaming(false)} onKeyDown={(e) => { if (e.key === 'Escape') setRenaming(false); }} />
        </form>
      ) : (
        <strong className="share-title" title={owner ? 'Click to rename' : undefined} onClick={() => owner && setRenaming(true)}>{info.title}</strong>
      )}
      <span className="muted">by {info.owner.username}</span>
      {share.role && !share.ended && <span className="badge">{ROLE[share.role]}</span>}
      {info.locked && <span className="badge warn" title="The owner locked this chart: nobody can change drawings">Locked</span>}
      <span className={`live-dot ${share.status}`} role="status">{STATUS[share.status]}</span>
      <div className="avatars" aria-label={`${everyone.length} here`}>
        {everyone.map((p) => <Avatar key={p.id} p={p} you={p.userId === you?.userId} presenting={p.userId === presentingUser} />)}
      </div>
      <div className="spacer" />
      {share.notice && <span className="share-notice" role="status">{share.notice}</span>}
      {share.status === 'live' && (
        share.presenting
          ? <button className="btn primary" onClick={() => share.present(false)}>Stop presenting</button>
          : <button className="btn" onClick={() => share.present(true)} title="Everyone here follows your timeframe and scroll">Present</button>
      )}
      {share.presenter && !share.presenting && (
        <button className="btn" aria-pressed={share.following} onClick={() => share.setFollowing(!share.following)} title={share.following ? 'Stop following (or just pan the chart)' : 'Follow the presenter’s view'}>
          {share.following ? `Following ${presenterName}` : `Follow ${presenterName}`}
        </button>
      )}
      <button className="btn quiet" onClick={() => void share.copyToMine()} title="Add these drawings to your own chart for this instrument">Copy to my charts</button>
      {owner && (
        <Popover label={<>People{waiting ? <span className="count" aria-label={`${waiting} waiting`}>{waiting}</span> : null}</>} wide onOpen={() => void share.refreshMembers()} className={waiting ? 'attention' : ''}>
          {(close) => (
            <div className="share-menu">
              <CopyLink label="Link" note="one link for everyone" url={shareLink(origin, info.id)} />
              <LinkAccessPicker value={info.linkAccess} onChange={(v) => void share.setLinkAccess(v)} />
              <PeoplePanel members={share.members} onSet={(id, r) => void share.setMember(id, r)} />
              <h4>Chart</h4>
              <div className="row wrap">
                <button className="btn" onClick={() => { void share.saveView(configFromView(view)); close(); }}>Save my view as the starting view</button>
                <button className="btn" onClick={() => void share.setLocked(!info.locked)} title="Nobody, you included, can change drawings while locked">{info.locked ? 'Unlock drawings' : 'Lock drawings'}</button>
                <button className="btn danger" onClick={async () => { if (confirm(`Delete “${info.title}” for everyone?`) && (await share.remove())) onExit(); }}>Delete</button>
              </div>
            </div>
          )}
        </Popover>
      )}
      <button className="btn quiet" onClick={onExit} title="Back to your own charts">Exit</button>
      {share.ended && <div className="banner error sharebar-ended" role="alert">{ENDED[share.ended]}</div>}
    </div>
  );
}
