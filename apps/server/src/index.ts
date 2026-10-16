import { loadConfig } from './config.ts';
import { UserStore } from './auth/db.ts';
import { createApp } from './app.ts';
import { createMarket } from './data/market.ts';
import { externalProvider, yahooProvider, type Provider } from './data/providers.ts';

// Load apps/server/.env when present (Node ≥ 20.12); real env vars win.
try { process.loadEnvFile('.env'); } catch { /* no .env file */ }
const config = loadConfig();
const store = await UserStore.open(config.databasePath);
const providers: Provider[] = config.providers.map((p) =>
  p === 'external' ? externalProvider(config.externalDataUrl!, config.externalApiKey ?? undefined) : yahooProvider());
const app = createApp({ config, store, market: createMarket(providers) });

const server = app.listen(config.port, () => {
  console.log(`[server] paradise-matrix on :${config.port} (${config.nodeEnv}) providers=${config.providers.join('>')} users=${config.databasePath}`);
  store.count().then((n) => { if (n === 0) console.warn('[server] no users yet — create one: npm run users -w apps/server -- add <name> --admin'); });
});
const stop = () => server.close(() => store.close().finally(() => process.exit(0)));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
