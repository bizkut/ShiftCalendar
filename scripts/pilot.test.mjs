import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { isAllowedLocalKey } from '../utils/localDataKeys.ts';

test('device backups and resets exclude sessions and every cloud-user namespace', () => {
  const keys = [
    'shift_data_cal_123', 'shift_notes_cal_123', 'schema_version', 'base_rate',
    'CognitoIdentityServiceProvider.client.sub.refreshToken',
    'CognitoIdentityServiceProvider.client.LastAuthUser',
    'shiftcalendar:cloud-mode', 'shiftcalendar:cloud:user-a:calendar',
    'shiftcalendar:cloud:user-b:calendar', 'base_rate_refreshToken',
    'all_shifts_v2.accessToken',
  ];
  assert.deepEqual(keys.filter(isAllowedLocalKey), keys.slice(0, 4));
});

const template = readFileSync(new URL('../infrastructure/template.yaml', import.meta.url), 'utf8');
const codeBlock = template.match(/    FunctionCode: \|\n([\s\S]*?)(?=^  \w)/m)?.[1];
assert.ok(codeBlock, 'CloudFront route function must exist');
const route = runInNewContext(codeBlock.replace(/^      /gm, '') + '\nhandler');

test('OAuth and application deep links resolve to the SPA', () => {
  for (const uri of ['/', '/login', '/callback', '/teams', '/settings']) {
    assert.equal(route({ request: { uri, method: 'GET' } }).uri, '/index.html');
  }
});

test('missing assets and non-read requests are not hidden by the SPA fallback', () => {
  for (const uri of ['/assets/missing.png', '/assets/no-extension', '/_expo/static/missing.js', '/favicon.ico']) {
    assert.equal(route({ request: { uri, method: 'GET' } }).uri, uri);
  }
  assert.equal(route({ request: { uri: '/callback', method: 'POST' } }).uri, '/callback');
});
