'use strict';
/**
 * Milestone 4 — Field configuration editor tests.
 * Covers: rename header vs label, add / delete / reorder columns,
 * change field type, edit help text, visibility, persist via PUT schema.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, Client } = require('./helpers');
const samples = require('../src/services/samples');

let srv;
let c;
before(async () => { srv = await startServer(); c = new Client(srv.base); });
after(async () => { await srv.close(); });

async function uploadEmployees() {
  const res = await c.upload(await samples.buildWorkbook(['employees']));
  assert.equal(res.status, 201);
  return res.data; // overview
}

async function getSheet(id, sheetId = 's1') {
  const r = await c.get(`/api/workbooks/${id}/sheets/${sheetId}`);
  assert.equal(r.status, 200);
  return r.data;
}

test('changes a display label without renaming the Excel header', async () => {
  const ov = await uploadEmployees();
  const { sheet } = await getSheet(ov.id);
  const col = sheet.columns.find((x) => x.header === 'Department');
  assert.ok(col, 'Department column must exist');

  // Rename the label but keep the header
  const updated = sheet.columns.map((c) => c.id === col.id ? { ...c, label: 'Division' } : c);
  const r = await c.put(`/api/workbooks/${ov.id}/sheets/s1/schema`, { baseRevision: ov.revision, columns: updated });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const found = r.data.sheet.columns.find((x) => x.id === col.id);
  assert.equal(found.label, 'Division');
  assert.equal(found.header, 'Department'); // Excel header unchanged
});

test('renames the actual Excel column header', async () => {
  const ov = await uploadEmployees();
  const { sheet } = await getSheet(ov.id);
  const col = sheet.columns.find((x) => x.header === 'Notes');
  const updated = sheet.columns.map((c) => c.id === col.id ? { ...c, header: 'Remarks', label: 'Remarks' } : c);
  const r = await c.put(`/api/workbooks/${ov.id}/sheets/s1/schema`, { baseRevision: ov.revision, columns: updated });
  assert.equal(r.status, 200);
  const found = r.data.sheet.columns.find((x) => x.id === col.id);
  assert.equal(found.header, 'Remarks');
  assert.equal(found.label, 'Remarks');
});

test('adds a new column with a label and default value', async () => {
  const ov = await uploadEmployees();
  const { sheet } = await getSheet(ov.id);
  const newCol = { label: 'Team', type: 'text', defaultValue: 'Unassigned' };
  const r = await c.put(`/api/workbooks/${ov.id}/sheets/s1/schema`, { baseRevision: ov.revision, columns: [...sheet.columns, newCol] });
  assert.equal(r.status, 200);
  const found = r.data.sheet.columns.find((x) => x.label === 'Team');
  assert.ok(found, 'new column must appear');
  assert.equal(found.type, 'text');
  assert.equal(r.data.summary.added, 1);
});

test('requires confirmation before deleting a column', async () => {
  const ov = await uploadEmployees();
  const { sheet } = await getSheet(ov.id);
  const col = sheet.columns.find((x) => x.header === 'Notes');
  // Omit the column without confirmDelete → expect 409
  const withoutNotes = sheet.columns.filter((x) => x.id !== col.id);
  const r409 = await c.put(`/api/workbooks/${ov.id}/sheets/s1/schema`, { baseRevision: ov.revision, columns: withoutNotes });
  assert.equal(r409.status, 409, 'should require confirmation');
  assert.equal(r409.data.code, 'DELETE_NOT_CONFIRMED');

  // Now confirm
  const rev2 = (await getSheet(ov.id)).revision;
  const rOk = await c.put(`/api/workbooks/${ov.id}/sheets/s1/schema`, { baseRevision: rev2, columns: withoutNotes, confirmDelete: [col.id] });
  assert.equal(rOk.status, 200);
  assert.equal(rOk.data.summary.removed, 1);
  assert.ok(!rOk.data.sheet.columns.find((x) => x.id === col.id));
});

test('changes a field type (text → textarea)', async () => {
  const ov = await uploadEmployees();
  const { sheet } = await getSheet(ov.id);
  const col = sheet.columns.find((x) => x.header === 'Notes');
  const updated = sheet.columns.map((x) => x.id === col.id ? { ...x, type: 'textarea' } : x);
  const r = await c.put(`/api/workbooks/${ov.id}/sheets/s1/schema`, { baseRevision: ov.revision, columns: updated });
  assert.equal(r.status, 200);
  assert.equal(r.data.sheet.columns.find((x) => x.id === col.id).type, 'textarea');
});

test('edits help text and visibility', async () => {
  const ov = await uploadEmployees();
  const { sheet } = await getSheet(ov.id);
  const col = sheet.columns.find((x) => x.header === 'Email');
  const updated = sheet.columns.map((x) => x.id === col.id ? { ...x, helpText: 'Work email address only', visible: false } : x);
  const r = await c.put(`/api/workbooks/${ov.id}/sheets/s1/schema`, { baseRevision: ov.revision, columns: updated });
  assert.equal(r.status, 200);
  const found = r.data.sheet.columns.find((x) => x.id === col.id);
  assert.equal(found.helpText, 'Work email address only');
  assert.equal(found.visible, false);
});

test('reorders columns and persists the order across reload', async () => {
  const ov = await uploadEmployees();
  const { sheet, revision } = await getSheet(ov.id);
  const reversed = [...sheet.columns].reverse();
  const r = await c.put(`/api/workbooks/${ov.id}/sheets/s1/schema`, { baseRevision: revision, columns: reversed });
  assert.equal(r.status, 200);
  const reloaded = (await getSheet(ov.id)).sheet;
  assert.deepEqual(reloaded.columns.map((x) => x.id), reversed.map((x) => x.id));
});

test('rejects a duplicate header name in one update', async () => {
  const ov = await uploadEmployees();
  const { sheet } = await getSheet(ov.id);
  const [first, second, ...rest] = sheet.columns;
  // Force both to the same header
  const bad = [{ ...first, header: 'dup' }, { ...second, header: 'dup' }, ...rest];
  const r = await c.put(`/api/workbooks/${ov.id}/sheets/s1/schema`, { baseRevision: ov.revision, columns: bad });
  assert.equal(r.status, 422);
});

test('schema changes persist when reloading the workbook', async () => {
  const ov = await uploadEmployees();
  const { sheet } = await getSheet(ov.id);
  const col = sheet.columns[0];
  const updated = sheet.columns.map((x) => x.id === col.id ? { ...x, label: 'Staff ID' } : x);
  await c.put(`/api/workbooks/${ov.id}/sheets/s1/schema`, { baseRevision: ov.revision, columns: updated });
  const reloaded = (await getSheet(ov.id)).sheet;
  assert.equal(reloaded.columns.find((x) => x.id === col.id).label, 'Staff ID');
});
