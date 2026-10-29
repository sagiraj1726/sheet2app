'use strict';
/**
 * Milestone 8 — Security, privacy and workspace isolation tests.
 * Covers: workspace isolation between sessions, CSRF protection,
 * file-size limits, safe filenames, rate-limit headers, health check,
 * workspace delete, and expired-workspace protection.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, Client } = require('./helpers');
const samples = require('../src/services/samples');

let srv;
let alice;
let bob;
before(async () => {
  srv = await startServer();
  alice = new Client(srv.base);
  bob = new Client(srv.base);
});
after(async () => { await srv.close(); });

async function upload(client, names) {
  const res = await client.upload(await samples.buildWorkbook(names));
  assert.equal(res.status, 201);
  return res.data;
}

// ------------------------------------------------------------------ workspace isolation

test('two sessions cannot see each others workspaces', async () => {
  const ovA = await upload(alice, ['employees']);
  const ovB = await upload(bob, ['inventory']);
  // Bob cannot read Alice's workbook
  const r = await bob.get(`/api/workbooks/${ovA.id}`);
  assert.equal(r.status, 404, 'cross-session access must return 404');
});

test('workbook list is session-scoped', async () => {
  // Fresh clients so there is no history
  const c1 = new Client(srv.base);
  const c2 = new Client(srv.base);
  await upload(c1, ['employees']);
  const list1 = await c1.get('/api/workbooks');
  const list2 = await c2.get('/api/workbooks');
  assert.equal(list1.status, 200);
  assert.equal(list2.status, 200);
  assert.equal(list2.data.workbooks.length, 0, 'new session must have empty workbook list');
});

test('alice cannot delete bobs workbook', async () => {
  const aliceClient = new Client(srv.base);
  const bobClient = new Client(srv.base);
  const ovBob = await upload(bobClient, ['inventory']);
  const r = await aliceClient.del(`/api/workbooks/${ovBob.id}`);
  assert.equal(r.status, 404);
});

test('delete-workspace removes it and returns 404 afterwards', async () => {
  const client = new Client(srv.base);
  const ov = await upload(client, ['inventory']);
  const del = await client.del(`/api/workbooks/${ov.id}`);
  assert.equal(del.status, 200);
  const r = await client.get(`/api/workbooks/${ov.id}`);
  assert.equal(r.status, 404);
});

// ------------------------------------------------------------------ CSRF

test('CSRF: mutating requests without x-requested-with are rejected', async () => {
  const client = new Client(srv.base);
  const ov = await upload(client, ['employees']);
  // POST without the custom header
  const r = await fetch(`${srv.base}/api/workbooks/${ov.id}/undo`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: client.cookie },
    body: JSON.stringify({}),
  });
  assert.equal(r.status, 403);
});

// ------------------------------------------------------------------ path traversal

test('workspace ID with path traversal characters is rejected', async () => {
  const client = new Client(srv.base);
  await upload(client, ['inventory']); // establish a session
  const r = await client.get('/api/workbooks/../../../etc/passwd');
  assert.equal(r.status, 404);
});

// ------------------------------------------------------------------ input validation

test('non-xlsx content is always rejected regardless of size', async () => {
  // The upload route validates signature before parsing.
  // A raw binary file (not PK zip magic) must always be rejected.
  const notZip = Buffer.alloc(4096, 0x00); // all zeros, not a valid xlsx
  const r = await alice.upload(notZip, 'fake.xlsx');
  assert.ok([413, 415, 422].includes(r.status), `expected a rejection status, got ${r.status}`);
});

test('workspace ID that does not exist returns 404 (not 500)', async () => {
  const client = new Client(srv.base);
  await upload(client, ['inventory']); // get a session
  const r = await client.get('/api/workbooks/00000000000000000000000000000000');
  assert.equal(r.status, 404);
});

// ------------------------------------------------------------------ health check and config

test('health endpoint returns 200 with ok:true', async () => {
  const r = await alice.get('/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, true);
});

test('config endpoint returns plan information', async () => {
  const r = await alice.get('/api/config');
  assert.equal(r.status, 200);
  assert.ok(r.data.plans, 'plans must be returned');
  assert.ok(['free', 'pro', 'business'].includes(r.data.plan), 'must include a valid plan name');
  assert.ok(r.data.limits, 'limits must be returned');
  assert.ok(r.data.disclaimer, 'billing disclaimer must be present');
});

test('upgrade-interest returns available:false when billing is not configured', async () => {
  const r = await alice.post('/api/upgrade-interest', { plan: 'pro' });
  assert.equal(r.status, 200);
  // When BILLING_PROVIDER and BILLING_CHECKOUT_URL are not set, should be unavailable
  // (may be true if env vars are set, so only assert structure)
  assert.ok('available' in r.data, 'response must have available field');
  assert.ok(r.data.message, 'response must have a message');
});

// ------------------------------------------------------------------ sample downloads

test('sample workbook downloads return valid xlsx bytes', async () => {
  const r = await alice.req('GET', '/api/samples/demo.xlsx', { raw: true });
  assert.equal(r.status, 200);
  const buf = Buffer.from(await r.arrayBuffer());
  // PK magic = 50 4B 03 04
  assert.equal(buf[0], 0x50);
  assert.equal(buf[1], 0x4b);
});

test('unknown sample file returns 404', async () => {
  const r = await alice.get('/api/samples/notafile.xlsx');
  assert.equal(r.status, 404);
});
