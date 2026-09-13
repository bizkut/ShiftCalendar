import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const env = { ...process.env, EXPO_PUBLIC_CLOUD_PROVIDER: 'cloudflare' };
for (const key of Object.keys(env)) {
  if (/^EXPO_PUBLIC_(API_URL|COGNITO_|USER_POOL_|WEB_CLIENT_|NATIVE_CLIENT_|WEB_URL)/.test(key)) delete env[key];
}
// Prevent local dotenv files from restoring AWS values after they are cleared.
env.EXPO_NO_DOTENV = '1';
const result = spawnSync('rtk', ['proxy', process.execPath, 'node_modules/expo/bin/cli',
  'export', '--platform', 'web', '--clear'], { cwd: root, env, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
writeFileSync(new URL('../dist/_headers', import.meta.url), `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  X-Frame-Options: DENY
  Cache-Control: no-cache

/_expo/static/*
  Cache-Control: public, max-age=31536000, immutable
`);
