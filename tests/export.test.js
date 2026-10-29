'use strict';
/**
 * Milestone 6 — Excel export tests.
 * Verifies that the downloaded workbook contains all edits:
 * edited values, added/deleted records, added/renamed/removed columns.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { startServer, Client } = require('./helpers');
const samples = require('../src/services/samples');

let srv;
let c;
before(async () => { srv = await startServer(); c = new Client(srv.base); });
after(async () => { await srv.close(); });

/** Upload a workbook built from `names`, return overview */
async function uploadSample(names) {
  const buf = await samples.buildWorkbook(names);
  const res = await c.upload(buf);
  assert.equal(res.status, 201);
  return res.data;
}

/** Download the export and parse it into an ExcelJS workbook */
async function downloadExport(id) {
  const res = await c.req('GET', `/api/workbooks/${id}/export.xlsx`, { raw: true });
  assert.equal(res.status, 200);
  const arrayBuf = await res.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(arrayBuf));
  return wb;
}

/**
 * Find the 1-based column number by header text in an ExcelJS worksheet.
 * Returns -1 when not found.
 */
function findColIdx(ws, headerText, headerRow = 1) {
  let idx = -1;
  ws.getRow(headerRow).eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const v = cell.value !== null && cell.value !== undefined ? String(cell.value).trim() : '';
    if (v === headerText) idx = colNumber;
  });
  return idx;
}

test('exported workbook contains all worksheets from original upload', async () => {
  const ov = await uploadSample(['employees', 'expenses', 'inventory']);
  const wb = await downloadExport(ov.id);
  const names = wb.worksheets.map((ws) => ws.name);
  assert.deepEqual(names, ['Employees', 'Monthly Expenses', 'Inventory']);
});

test('edited cell value appears in the exported workbook', async () => {
  const ov = await uploadSample(['employees']);
  const sh = (await c.get(`/api/workbooks/${ov.id}/sheets/s1`)).data;
  const rec = sh.sheet.rows[0];
  const nameCol = sh.sheet.columns.find((x) => x.header === 'Employee Name');
  await c.post(`/api/workbooks/${ov.id}/sheets/s1/submit`, {
    baseRevision: sh.revision,
    changes: [{ op: 'update', id: rec.id, values: { [nameCol.id]: 'Exported Person' } }],
  });
  const wb = await downloadExport(ov.id);
  const ws = wb.getWorksheet('Employees');
  const nameIdx = findColIdx(ws, 'Employee Name');
  assert.ok(nameIdx > 0, 'Employee Name column must exist');
  const dataRow = ws.getRow(2);
  assert.equal(String(dataRow.getCell(nameIdx).value).trim(), 'Exported Person');
});

test('added record appears in the exported workbook', async () => {
  const ov = await uploadSample(['inventory']);
  const sh = (await c.get(`/api/workbooks/${ov.id}/sheets/s1`)).data;
  const col = (name) => sh.sheet.columns.find((x) => x.header === name);
  const values = {
    [col('Product').id]: 'New Export Product',
    [col('Category').id]: 'Stationery',
    [col('Quantity').id]: '5',
    [col('Unit Price').id]: '100',
  };
  const addRes = await c.post(`/api/workbooks/${ov.id}/sheets/s1/submit`, {
    baseRevision: sh.revision,
    changes: [{ op: 'add', values }],
  });
  assert.equal(addRes.status, 200, `submit failed: ${JSON.stringify(addRes.data)}`);
  const wb = await downloadExport(ov.id);
  const ws = wb.getWorksheet('Inventory');
  const nameIdx = findColIdx(ws, 'Product');
  assert.ok(nameIdx > 0, `'Product' column not found in exported worksheet`);
  let found = false;
  ws.eachRow((row, rowNum) => {
    if (rowNum > 1 && String(row.getCell(nameIdx).value || '').trim() === 'New Export Product') found = true;
  });
  assert.ok(found, 'Added record must appear in export');
});

test('deleted record is absent from the exported workbook', async () => {
  const ov = await uploadSample(['inventory']);
  const sh = (await c.get(`/api/workbooks/${ov.id}/sheets/s1`)).data;
  const rec = sh.sheet.rows[0];
  const nameCol = sh.sheet.columns.find((x) => x.header === 'Product');
  const deletedName = rec.v[nameCol.id];
  const delRes = await c.post(`/api/workbooks/${ov.id}/sheets/s1/submit`, {
    baseRevision: sh.revision,
    changes: [{ op: 'delete', id: rec.id }],
  });
  assert.equal(delRes.status, 200, `submit failed: ${JSON.stringify(delRes.data)}`);
  const wb = await downloadExport(ov.id);
  const ws = wb.getWorksheet('Inventory');
  const nameIdx = findColIdx(ws, 'Product');
  assert.ok(nameIdx > 0, `'Product' column not found in exported worksheet`);
  let found = false;
  ws.eachRow((row, rowNum) => {
    if (rowNum > 1 && String(row.getCell(nameIdx).value || '').trim() === deletedName) found = true;
  });
  assert.ok(!found, 'Deleted record must NOT appear in export');
});

test('added column appears in the exported workbook header', async () => {
  const ov = await uploadSample(['inventory']);
  const sh = (await c.get(`/api/workbooks/${ov.id}/sheets/s1`)).data;
  const newCol = { label: 'Warehouse', header: 'Warehouse', type: 'text' };
  await c.put(`/api/workbooks/${ov.id}/sheets/s1/schema`, {
    baseRevision: sh.revision,
    columns: [...sh.sheet.columns, newCol],
  });
  const wb = await downloadExport(ov.id);
  const ws = wb.getWorksheet('Inventory');
  assert.ok(findColIdx(ws, 'Warehouse') > 0, 'New column header must appear in export');
});

test('removed column is absent from the exported workbook', async () => {
  const ov = await uploadSample(['employees']);
  const sh = (await c.get(`/api/workbooks/${ov.id}/sheets/s1`)).data;
  const col = sh.sheet.columns.find((x) => x.header === 'Notes');
  const without = sh.sheet.columns.filter((x) => x.id !== col.id);
  await c.put(`/api/workbooks/${ov.id}/sheets/s1/schema`, {
    baseRevision: sh.revision,
    columns: without,
    confirmDelete: [col.id],
  });
  const wb = await downloadExport(ov.id);
  const ws = wb.getWorksheet('Employees');
  assert.equal(findColIdx(ws, 'Notes'), -1, 'Removed column must NOT appear in export');
});

test('renamed column header appears correctly in export', async () => {
  const ov = await uploadSample(['employees']);
  const sh = (await c.get(`/api/workbooks/${ov.id}/sheets/s1`)).data;
  const col = sh.sheet.columns.find((x) => x.header === 'Notes');
  const updated = sh.sheet.columns.map((x) => x.id === col.id ? { ...x, header: 'Remarks', label: 'Remarks' } : x);
  await c.put(`/api/workbooks/${ov.id}/sheets/s1/schema`, { baseRevision: sh.revision, columns: updated });
  const wb = await downloadExport(ov.id);
  const ws = wb.getWorksheet('Employees');
  assert.ok(findColIdx(ws, 'Remarks') > 0, 'Renamed header must appear in export');
  assert.equal(findColIdx(ws, 'Notes'), -1, 'Old header must NOT appear in export');
});

test('CSV export contains correct headers and row count', async () => {
  const ov = await uploadSample(['inventory']);
  const sh = (await c.get(`/api/workbooks/${ov.id}/sheets/s1`)).data;
  const res = await c.req('GET', `/api/workbooks/${ov.id}/sheets/s1/export.csv`, { raw: true });
  assert.equal(res.status, 200);
  const text = await res.text();
  // CSV uses \r\n and includes a BOM character; strip it before splitting
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.length > 0);
  // header line + data rows
  assert.equal(lines.length, sh.sheet.rows.length + 1, 'CSV row count should match data + header');
  // Inventory always has SKU column
  assert.ok(lines[0].includes('SKU'), 'CSV must include at least the SKU header');
});
