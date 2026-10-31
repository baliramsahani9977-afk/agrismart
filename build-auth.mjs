import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = path.dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [path.join(projectDir, 'cognitoAuth.ts')],
  outfile: path.join(projectDir, 'dist', 'cognito-auth.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  logLevel: 'info'
});
