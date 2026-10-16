// Runs API and web dev servers together (cross-platform; `&` is sequential on Windows).
import { spawn } from 'node:child_process';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const procs = ['apps/server', 'apps/web'].map((w) =>
  spawn(npm, ['run', 'dev', '-w', w], { stdio: 'inherit', shell: process.platform === 'win32' }));
const stop = () => { for (const p of procs) p.kill(); process.exit(); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', (code) => { if (code) stop(); });
