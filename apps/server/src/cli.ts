/**
 * User management without the web UI.
 *   npm run users -w apps/server -- list
 *   npm run users -w apps/server -- add <username> [--admin]     (prompts for password)
 *   npm run users -w apps/server -- passwd <username>
 *   npm run users -w apps/server -- admin <username> on|off
 *   npm run users -w apps/server -- remove <username>
 * Uses DATABASE_PATH (default ./data/app.db).
 */
import { createInterface } from 'node:readline/promises';
import { UserStore } from './auth/db.ts';

async function ask(q: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await rl.question(q)).trim(); } finally { rl.close(); }
}

try { process.loadEnvFile('.env'); } catch { /* no .env file */ }
const [cmd, name, arg] = process.argv.slice(2);
const store = await UserStore.open(process.env.DATABASE_PATH ?? process.env.DATABASE_URL ?? './data/app.db');
try {
  switch (cmd) {
    case 'list':
      console.table(await store.list());
      break;
    case 'add': {
      if (!name) throw new Error('usage: add <username> [--admin]');
      const pw = process.env.NEW_PASSWORD ?? (await ask(`password for ${name}: `));
      if (pw.length < 8) throw new Error('password must be at least 8 characters');
      console.log(await store.create(name, pw, process.argv.includes('--admin')));
      break;
    }
    case 'passwd': {
      const u = name && (await store.byUsername(name));
      if (!u) throw new Error('no such user');
      const pw = process.env.NEW_PASSWORD ?? (await ask(`new password for ${name}: `));
      if (pw.length < 8) throw new Error('password must be at least 8 characters');
      await store.update(u.id, { password: pw });
      console.log('updated');
      break;
    }
    case 'admin': {
      const u = name && (await store.byUsername(name));
      if (!u || (arg !== 'on' && arg !== 'off')) throw new Error('usage: admin <username> on|off');
      console.log(await store.update(u.id, { isAdmin: arg === 'on' }));
      break;
    }
    case 'remove': {
      const u = name && (await store.byUsername(name));
      if (!u) throw new Error('no such user');
      await store.remove(u.id);
      console.log('removed');
      break;
    }
    default:
      console.log('commands: list | add <user> [--admin] | passwd <user> | admin <user> on|off | remove <user>');
  }
} catch (e) {
  console.error(String((e as Error).message));
  process.exitCode = 1;
} finally {
  await store.close();
}
