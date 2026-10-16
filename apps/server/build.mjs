// Bundles the server and its workspace packages into dist/server.js.
// npm dependencies stay external (installed on the host).
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)));
const external = Object.keys(pkg.dependencies).filter((d) => !d.startsWith('@paradise/'));
await build({
  entryPoints: ['src/index.ts'], outfile: 'dist/server.js', bundle: true, platform: 'node', format: 'esm',
  target: 'node20', sourcemap: true, external, logLevel: 'info',
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
await build({
  entryPoints: ['src/cli.ts'], outfile: 'dist/cli.js', bundle: true, platform: 'node', format: 'esm',
  target: 'node20', external, logLevel: 'warning',
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
