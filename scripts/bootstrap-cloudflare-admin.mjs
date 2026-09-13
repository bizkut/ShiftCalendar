import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Operator-only bootstrap: obtain the subject from the approved user's verified
// /v1/session response. Email admission alone never confers administrator status.
const sub = process.argv[2];
if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(sub ?? '')) {
  throw new Error('Usage: node scripts/bootstrap-cloudflare-admin.mjs <verified-user-subject-uuid>');
}
const sql = `INSERT INTO application_administrators(user_sub,created_at)
  SELECT sub,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM users
  WHERE sub='${sub}' AND disabled=0
    AND NOT EXISTS(SELECT 1 FROM application_administrators);
  SELECT user_sub,created_at FROM application_administrators;`;
const result = spawnSync('rtk', ['proxy', 'npm', 'exec', '--', 'wrangler', 'd1', 'execute',
  'shiftcalendar', '--remote', '--config', 'wrangler.production.jsonc', '--command', sql, '--json'], {
  cwd: fileURLToPath(new URL('../cloudflare/', import.meta.url)), encoding: 'utf8',
});
if (result.status !== 0) throw new Error('Bootstrap failed; inspect Cloudflare deployment authentication and migrations.');
const records = JSON.parse(result.stdout);
const admins = records.at(-1)?.results;
if (admins?.length !== 1 || admins[0].user_sub !== sub) {
  throw new Error('Bootstrap refused: user is absent/disabled or a different administrator already exists.');
}
console.log('The verified user is the initial application administrator. Private-calendar access remains owner-only.');
