import type { LinkAccess } from '@paradise/contract';

export const LINK_ACCESS_TEXT: Record<LinkAccess, { label: string }> = {
  viewer: { label: 'Can view' },
  editor: { label: 'Can edit' },
  approval: { label: 'Must ask to join' },
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
    </div>
  );
}
