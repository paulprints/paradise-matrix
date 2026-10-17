/**
 * Loads apps/server/.env (relative to the working directory) and SAYS what
 * happened. A silently missing .env starts the server on defaults — wrong
 * port, ephemeral secret — which is worse than failing loudly.
 * Real environment variables always win over the file.
 */
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

export type EnvLoadResult =
  | { status: 'loaded'; path: string }
  | { status: 'missing'; path: string; lookalikes: string[] }
  | { status: 'unsupported'; path: string }
  | { status: 'error'; path: string; message: string };

export function loadDotEnv(dir = process.cwd(), log: (msg: string) => void = (m) => console.log(m)): EnvLoadResult {
  const path = resolve(dir, '.env');
  let result: EnvLoadResult;
  if (!existsSync(path)) {
    const lookalikes = readdirSync(dir).filter((f) => /^\.?env(\..+)?$/i.test(f) && f !== '.env' && f !== '.env.example');
    result = { status: 'missing', path, lookalikes };
  } else if (typeof process.loadEnvFile !== 'function') {
    result = { status: 'unsupported', path };
  } else {
    try {
      process.loadEnvFile(path);
      result = { status: 'loaded', path };
    } catch (e) {
      result = { status: 'error', path, message: (e as Error).message };
    }
  }
  if (result.status === 'loaded') log(`[config] loaded ${path}`);
  else if (result.status === 'missing') {
    log(`[config] no .env at ${path} — using environment variables and defaults`);
    if (result.lookalikes.length) log(`[config]   found ${result.lookalikes.join(', ')} — did you mean to name it .env?`);
  } else if (result.status === 'unsupported') log(`[config] found ${path} but Node ${process.version} can't load .env files (needs 20.12+) — upgrade Node`);
  else log(`[config] could not read ${path}: ${result.message}`);
  return result;
}
