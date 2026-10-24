import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Drawing } from '@paradise/contract';
import { personalSource, type SaveStatus } from '../src/drawings/useDrawings.ts';

const line = (id: string): Drawing => ({ id, kind: 'hline', color: 'ink', p: 700 });
const reply = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status }));

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('personal drawings: saving from a stale tab', () => {
  it('sends the loaded version, and on a conflict shows the stored drawings instead of overwriting them', async () => {
    vi.useFakeTimers();
    const sent: any[] = [];
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
      if (init.method === 'GET') return reply(200, { symbol: 'QQQ', drawings: [line('a')], updatedAt: 'v1' });
      sent.push(JSON.parse(String(init.body)));
      return reply(409, { error: 'changed elsewhere', details: { symbol: 'QQQ', drawings: [line('a'), line('other-tab')], updatedAt: 'v2' } });
    }));
    const src = personalSource('QQQ');
    const shown: Drawing[][] = [];
    src.subscribe!((d) => shown.push(d));
    const status: SaveStatus[] = [];
    await src.load(new AbortController().signal);

    src.save([], (s) => status.push(s));
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent).toEqual([{ symbol: 'QQQ', drawings: [], baseUpdatedAt: 'v1' }]);
    expect(shown).toEqual([[line('a'), line('other-tab')]]);
    expect(status).toEqual(['saving', 'conflict']);

    // The next edit is based on the reloaded copy.
    src.save([line('a')], () => {});
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent[1].baseUpdatedAt).toBe('v2');
  });
});
