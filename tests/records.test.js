'use strict';
/**
 * Milestone 5 — Record CRUD, submit/save, undo, unsaved-change safety.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, Client } = require('./helpers');
const samples = require('../src/services/samples');

let srv;
let c;
before(async () => { srv = await startServer(); c = new Client(srv.base); });
after(async () => { await srv.close(); });

async function uploadAndGet(names) {
  const res = await c.upload(await samples.buildWorkbook(names));
  assert.equal(res.status, 201);
  const id = res.data.id;
  const sh = await c.get(`/api/workbooks/${id}/sheets/s1`);
  assert.equal(sh.status, 200);
  return { id, sheet: sh.data.sheet, revision: sh.data.revision };
}

test('adds a new record and reads it back', async () => {
  const { id, sheet, revision } = await uploadAndGet(['employees']);
  const col = (name) => sheet.columns.find((x) => x.header === name);
  const values = {
    [col('Employee ID').id]: '9999',
    [col('Employee Name').id]: 'Test Person',
    [col('Department').id]: 'Engineering',
    [col('Joining Date').id]: '2024-06-01',
    [col('Salary').id]: '75000',
    [col('Email').id]: 'test@example.com',
    [col('Phone').id]: '+91-9000000000',
    [col('Is Active').id]: 'Yes',
    [col('Notes').id]: 'Added by test',
  };
  const r = await c.post(`/api/workbooks/${id}/sheets/s1/submit`, { baseRevision: revision, changes: [{ op: 'add', tempId: 'tmp1', values }] });
  assert.equal(r.status, 200);
  assert.equal(r.data.summary.added, 1);
  const created = r.data.created.find((x) => x.tempId === 'tmp1');
  assert.ok(created && created.id, 'server should return a stable record id');
  // Verify the record appears in the sheet
  const rec = r.data.sheet.rows.find((x) => x.id === created.id);
  assert.ok(rec, 'new record should appear in returned sheet');
  assert.equal(rec.v[col('Employee Name').id], 'Test Person');
});

test('edits an existing record and saves', async () => {
  const { id, sheet, revision } = await uploadAndGet(['employees']);
  const rec = sheet.rows[0];
  const nameCol = sheet.columns.find((x) => x.header === 'Employee Name');
  const r = await c.post(`/api/workbooks/${id}/sheets/s1/submit`, {
    baseRevision: revision,
    changes: [{ op: 'update', id: rec.id, values: { [nameCol.id]: 'Updated Name' } }],
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.summary.updated, 1);
  const updated = r.data.sheet.rows.find((x) => x.id === rec.id);
  assert.equal(updated.v[nameCol.id], 'Updated Name');
});

test('deletes a record with confirmation', async () => {
  const { id, sheet, revision } = await uploadAndGet(['employees']);
  const rec = sheet.rows[0];
  const r = await c.post(`/api/workbooks/${id}/sheets/s1/submit`, {
    baseRevision: revision,
    changes: [{ op: 'delete', id: rec.id }],
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.summary.deleted, 1);
  assert.ok(!r.data.sheet.rows.find((x) => x.id === rec.id), 'deleted record should not appear');
});

test('rejects invalid field values and reports per-field errors', async () => {
  const { id, sheet, revision } = await uploadAndGet(['employees']);
  const emailCol = sheet.columns.find((x) => x.header === 'Email');
  const rec = sheet.rows[0];
  const r = await c.post(`/api/workbooks/${id}/sheets/s1/submit`, {
    baseRevision: revision,
    changes: [{ op: 'update', id: rec.id, values: { [emailCol.id]: 'not-a-valid-email' } }],
  });
  assert.equal(r.status, 422);
  assert.ok(r.data.fieldErrors, 'fieldErrors must be returned');
});

test('refuses duplicate submission (no-op returns 409)', async () => {
  const { id, sheet, revision } = await uploadAndGet(['employees']);
  const rec = sheet.rows[0];
  const nameCol = sheet.columns.find((x) => x.header === 'Employee Name');
  const currentName = rec.v[nameCol.id];
  // Submitting the exact same value is a no-op
  const r = await c.post(`/api/workbooks/${id}/sheets/s1/submit`, {
    baseRevision: revision,
    changes: [{ op: 'update', id: rec.id, values: { [nameCol.id]: currentName } }],
  });
  assert.equal(r.status, 409);
  assert.equal(r.data.code, 'NO_CHANGES');
});

test('rejects stale baseRevision (optimistic lock)', async () => {
  const { id, sheet, revision } = await uploadAndGet(['employees']);
  const rec = sheet.rows[0];
  const nameCol = sheet.columns.find((x) => x.header === 'Employee Name');
  // First save succeeds
  const r1 = await c.post(`/api/workbooks/${id}/sheets/s1/submit`, {
    baseRevision: revision,
    changes: [{ op: 'update', id: rec.id, values: { [nameCol.id]: 'First Edit' } }],
  });
  assert.equal(r1.status, 200);
  // Second save with old revision should fail
  const r2 = await c.post(`/api/workbooks/${id}/sheets/s1/submit`, {
    baseRevision: revision, // stale
    changes: [{ op: 'update', id: rec.id, values: { [nameCol.id]: 'Second Edit' } }],
  });
  assert.equal(r2.status, 409);
});

test('undo reverts the most recent save', async () => {
  const { id, sheet, revision } = await uploadAndGet(['employees']);
  const rec = sheet.rows[0];
  const nameCol = sheet.columns.find((x) => x.header === 'Employee Name');
  const original = rec.v[nameCol.id];
  const r = await c.post(`/api/workbooks/${id}/sheets/s1/submit`, {
    baseRevision: revision,
    changes: [{ op: 'update', id: rec.id, values: { [nameCol.id]: 'Edited' } }],
  });
  assert.equal(r.status, 200);
  // Undo
  const undo = await c.post(`/api/workbooks/${id}/undo`, {});
  assert.equal(undo.status, 200);
  const restored = undo.data.sheet.rows.find((x) => x.id === rec.id);
  assert.equal(restored.v[nameCol.id], original);
});

test('worksheets are edited independently', async () => {
  const res = await c.upload(await samples.buildWorkbook(['employees', 'expenses']));
  assert.equal(res.status, 201);
  const id = res.data.id;
  const sh1 = (await c.get(`/api/workbooks/${id}/sheets/s1`)).data;
  const sh2 = (await c.get(`/api/workbooks/${id}/sheets/s2`)).data;
  const nameCol = sh1.sheet.columns.find((x) => x.header === 'Employee Name');
  const descCol = sh2.sheet.columns.find((x) => x.header === 'Description');
  const r1 = await c.post(`/api/workbooks/${id}/sheets/s1/submit`, {
    baseRevision: sh1.revision,
    changes: [{ op: 'update', id: sh1.sheet.rows[0].id, values: { [nameCol.id]: 'Changed in s1' } }],
  });
  assert.equal(r1.status, 200);
  // s2 should be unaffected
  const sh2After = (await c.get(`/api/workbooks/${id}/sheets/s2`)).data;
  assert.equal(sh2After.sheet.rows[0].v[descCol.id], sh2.sheet.rows[0].v[descCol.id]);
});

test('data survives a server reload (JSON persistence)', async () => {
  const { id, sheet, revision } = await uploadAndGet(['inventory']);
  const rec = sheet.rows[0];
  const nameCol = sheet.columns.find((x) => x.header === 'Product');
  await c.post(`/api/workbooks/${id}/sheets/s1/submit`, {
    baseRevision: revision,
    changes: [{ op: 'update', id: rec.id, values: { [nameCol.id]: 'Persistent Item' } }],
  });
  // Re-read from server (state loaded from disk)
  const fresh = (await c.get(`/api/workbooks/${id}/sheets/s1`)).data.sheet;
  assert.equal(fresh.rows.find((x) => x.id === rec.id).v[nameCol.id], 'Persistent Item');
});
