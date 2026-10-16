import { randomBytes } from 'node:crypto';

export interface Config {
  port: number;
  nodeEnv: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  databasePath: string;
  allowedOrigins: string[];
  providers: Array<'external' | 'yahoo'>;
  externalDataUrl: string | null;
  externalApiKey: string | null;
  trustProxy: number;
}

export class ConfigError extends Error {}

const DEFAULT_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const nodeEnv = env.NODE_ENV ?? 'development';
  let jwtSecret = env.JWT_SECRET ?? '';
  if (jwtSecret.length < 32) {
    if (nodeEnv === 'production') throw new ConfigError('JWT_SECRET must be set to 32+ characters in production');
    jwtSecret = randomBytes(48).toString('base64url');
    if (nodeEnv !== 'test') console.warn('[config] JWT_SECRET not set — using an ephemeral secret (sessions reset on restart)');
  }
  const providers = (env.DATA_PROVIDERS ?? 'external,yahoo').split(',').map((s) => s.trim()).filter(Boolean);
  for (const p of providers) if (p !== 'external' && p !== 'yahoo') throw new ConfigError(`unknown data provider "${p}"`);
  const externalDataUrl = env.EXTERNAL_DATA_URL?.trim() || null;
  const usable = providers.filter((p) => p !== 'external' || externalDataUrl) as Config['providers'];
  if (!usable.length) throw new ConfigError('no usable data provider (set EXTERNAL_DATA_URL or include yahoo)');
  return {
    port: Number(env.PORT ?? 3001),
    nodeEnv,
    jwtSecret,
    jwtExpiresIn: env.JWT_EXPIRES_IN ?? '24h',
    databasePath: env.DATABASE_PATH ?? env.DATABASE_URL ?? './data/app.db',
    allowedOrigins: [...DEFAULT_ORIGINS, ...(env.ALLOWED_ORIGINS ?? env.FRONTEND_URL ?? '').split(',').map((s) => s.trim()).filter(Boolean)],
    providers: usable,
    externalDataUrl,
    externalApiKey: env.EXTERNAL_API_KEY?.trim() || null,
    trustProxy: Number(env.TRUST_PROXY ?? 1),
  };
}
