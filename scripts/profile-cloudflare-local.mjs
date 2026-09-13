// Diagnostic only: local workerd timings are not production CPU acceptance.
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from '../cloudflare/node_modules/miniflare/dist/src/index.js';
import { build } from '../cloudflare/node_modules/esbuild/lib/main.js';
import { generateKeyPair, exportJWK, SignJWT } from '../cloudflare/node_modules/jose/dist/webapi/index.js';

const root = new URL('../', import.meta.url).pathname;
const output = process.argv[2] || join(tmpdir(), 'shiftcalendar-local-cpu.json');
const temp = await mkdtemp(join(tmpdir(), 'shiftcalendar-profile-'));
const issuer = 'https://local-profile.cloudflareaccess.com';
const origin = 'https://local-profile.invalid';
const calendarId = '11111111-1111-4111-8111-111111111111';
let mf, socket;
try {
  const bundle = join(temp, 'worker.mjs');
  await build({ entryPoints: [join(root, 'cloudflare/src/index.ts')], bundle: true,
    format: 'esm', platform: 'browser', target: 'esnext', outfile: bundle,
    minify: process.argv.includes('--minify') });
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...await exportJWK(publicKey), kid: 'local-fixture', alg: 'RS256', use: 'sig' };
  const token = await new SignJWT({ email: 'profile@example.invalid' })
    .setProtectedHeader({ alg: 'RS256', kid: jwk.kid }).setSubject('profile')
    .setIssuer(issuer).setAudience('local-profile').setIssuedAt().setExpirationTime('10m').sign(privateKey);
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: await readFile(bundle, 'utf8'), name: 'profile',
    compatibilityDate: '2026-09-13', compatibilityFlags: ['nodejs_compat'], inspectorPort: 0,
    d1Databases: { DB: 'local-profile' },
    bindings: { ACCESS_ISSUER: issuer, ACCESS_AUDIENCE: 'local-profile', APP_ORIGIN: origin },
    outboundService: request => {
      assert.equal(request.url, issuer + '/cdn-cgi/access/certs');
      return Response.json({ keys: [jwk] });
    } }));
  await mf.ready;
  const db = await mf.getD1Database('DB');
  const schema = await readFile(join(root, 'cloudflare/migrations/0001_calendar.sql'), 'utf8');
  for (const sql of schema.split(';').map(s => s.trim()).filter(Boolean)) await db.prepare(sql).run();
  await db.prepare("INSERT INTO users(sub) VALUES('profile')").run();
  await db.prepare(`INSERT INTO calendars(id,owner_sub,name,color,timezone,updated_at)
    VALUES(?,'profile','Profile','#123456','Asia/Kuala_Lumpur',?)`).bind(calendarId, new Date().toISOString()).run();
  const inspector = await mf.getInspectorURL();
  inspector.protocol = 'http:';
  const targets = await (await fetch(new URL('/json', inspector))).json();
  const target = targets.find(t => t.title.includes('profile'));
  assert.ok(target, 'Worker inspector target missing');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const response = JSON.parse(event.data);
    const request = pending.get(response.id);
    if (request) { pending.delete(response.id); clearTimeout(request.timer); response.error ? request.reject(new Error(response.error.message)) : request.resolve(response.result); }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('Profiler command timed out')); }, 15000);
    pending.set(requestId, { resolve, reject, timer });
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
  await send('Profiler.enable');
  await send('Profiler.setSamplingInterval', { interval: 100 });
  const profiles = [];
  for (let version = 0; version < 3; version++) {
    await send('Profiler.start');
    const response = await mf.dispatchFetch(`${origin}/v1/calendars/${calendarId}/days/2026-09-14`, {
      method: 'PATCH', headers: { 'Cf-Access-Jwt-Assertion': token, Origin: origin,
        'Content-Type': 'application/json', 'X-ShiftCalendar-Request': '1' },
      body: JSON.stringify({ expectedVersion: version, mutationId: crypto.randomUUID(), value: { shiftCode: 'M' } }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.version, version + 1);
    const { profile } = await send('Profiler.stop');
    profiles.push({ phase: version === 0 ? 'cold' : 'warm', profile });
  }
  await writeFile(output, JSON.stringify({ diagnostic: 'Local workerd, generated fixture identity and ephemeral D1; no production credentials/data', profiles }));
  for (const { phase, profile } of profiles) {
    const nodes = new Map(profile.nodes.map(n => [n.id, n]));
    const totals = new Map();
    profile.samples.forEach((id, i) => {
      const f = nodes.get(id).callFrame;
      const key = `${f.functionName || '(anonymous)'}:${f.url.split('/').pop()}:${f.lineNumber + 1}`;
      totals.set(key, (totals.get(key) || 0) + profile.timeDeltas[i]);
    });
    console.log(JSON.stringify({ phase, topSampledMicroseconds: [...totals].sort((a, b) => b[1] - a[1]).slice(0, 15) }));
  }
  console.log(`Diagnostic profile saved to ${output}`);
} finally {
  socket?.close();
  await mf?.dispose();
  await rm(temp, { recursive: true, force: true });
}
