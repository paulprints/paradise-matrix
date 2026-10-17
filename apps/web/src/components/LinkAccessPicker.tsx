import type { LinkAccess } from '@paradise/contract';

export const LINK_ACCESS_TEXT: Record<LinkAccess, { label: string; note: string }> = {
  viewer: { label: 'Can view', note: 'People who open the link watch live. You choose who can edit.' },
  editor: { label: 'Can edit', note: 'People who open the link can draw right away. You can switch anyone to view-only.' },
  approval: { label: 'Must ask to join', note: 'People who open the link wait until you let them in.' },
};

/** "Anyone who opens the link: …" */
export function LinkAccessPicker({ value, onChange, disabled }: { value: LinkAccess; onChange: (v: LinkAccess) => void; disabled?: boolean }) {
  return (
    <div className="link-access">
      <label className="field stack">
        <span className="muted">Anyone signed in who opens the link</span>
        <select value={value} onChange={(e) => onChange(e.target.value as LinkAccess)} disabled={disabled}>
          {(Object.keys(LINK_ACCESS_TEXT) as LinkAccess[]).map((k) => <option key={k} value={k}>{LINK_ACCESS_TEXT[k].label}</option>)}
        </select>
      </label>
      <p className="note">{LINK_ACCESS_TEXT[value].note}</p>
    </div>
  );
}
