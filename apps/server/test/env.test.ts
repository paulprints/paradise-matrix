import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadDotEnv } from '../src/env.ts';

const dir = () => mkdtempSync(join(tmpdir(), 'pm-env-'));
afterEach(() => { delete process.env.PM_TEST_PORT; delete process.env.PM_TEST_DB; });

describe('loadDotEnv', () => {
  it('loads .env, strips inline comments, keeps Windows paths, and reports it', () => {
    const d = dir();
    writeFileSync(join(d, '.env'), 'PM_TEST_PORT=3002   # v2 port\nPM_TEST_DB=C:\\matrix-v2\\data\\app.db    # point at the old backend\n');
    const logs: string[] = [];
    expect(loadDotEnv(d, (m) => logs.push(m)).status).toBe('loaded');
    expect(process.env.PM_TEST_PORT).toBe('3002');
    expect(process.env.PM_TEST_DB).toBe('C:\\matrix-v2\\data\\app.db');
    expect(logs[0]).toMatch(/loaded .*\.env/);
  });
  it('says loudly when .env is missing and points at look-alikes like .env.txt', () => {
    const d = dir();
    writeFileSync(join(d, '.env.txt'), 'X=1');
    writeFileSync(join(d, '.env.example'), 'X=1');
    const logs: string[] = [];
    const r = loadDotEnv(d, (m) => logs.push(m));
    expect(r).toMatchObject({ status: 'missing', lookalikes: ['.env.txt'] });
    expect(logs.join('\n')).toMatch(/no \.env at[\s\S]*\.env\.txt — did you mean/);
  });
});
