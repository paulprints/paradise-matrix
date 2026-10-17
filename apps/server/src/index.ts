import { loadConfig } from './config.ts';
import { loadDotEnv } from './env.ts';
import { UserStore } from './auth/db.ts';
import { createApp } from './app.ts';
import { createMarket } from './data/market.ts';
import { externalProvider, yahooProvider, type Provider } from './data/providers.ts';
import { LiveHub } from './shares/live.ts';
import { SharesStore } from './shares/store.ts';

loadDotEnv();
const config = loadConfig();
const store = await UserStore.open(config.databasePath);
const providers: Provider[] = config.providers.map((p) =>
  p === 'external' ? externalProvider(config.externalDataUrl!, config.externalApiKey ?? undefined) : yahooProvider());
const shares = await SharesStore.open(store.db);
const live = new LiveHub({ config, store, shares });
const app = createApp({ config, store, market: createMarket(providers), shares, live });

const server = app.listen(config.port, () => {
  live.attach(server);
  console.log(`[server] paradise-matrix on :${config.port} (${config.nodeEnv}) providers=${config.providers.join('>')} users=${config.databasePath}`);
  store.count().then((n) => { if (n === 0) console.warn('[server] no users yet — create one: npm run users -w apps/server -- add <name> --admin'); });
});
const stop = () => server.close(() => store.close().finally(() => process.exit(0)));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
