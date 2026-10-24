import { useState } from 'react';
import { copyText } from '../lib/clipboard.ts';

/** A labelled, selectable link with a Copy button. */
export function CopyLink({ label, url, note }: { label: string; url: string; note?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  return (
    <div className="copy-link">
      <div className="copy-link-head"><span>{label}</span>{note && <span className="muted">{note}</span>}</div>
      <div className="copy-link-row">
        <input value={url} readOnly aria-label={label} onFocus={(e) => e.currentTarget.select()} />
        <button className={`btn ${state}`} onClick={async () => { setState((await copyText(url)) ? 'copied' : 'failed'); setTimeout(() => setState('idle'), 1800); }}>
          {state === 'copied' ? '✓ Copied' : state === 'failed' ? 'Select & copy' : 'Copy'}
        </button>
        <span className="sr-only" role="status">{state === 'copied' ? 'Link copied' : ''}</span>
      </div>
    </div>
  );
}
