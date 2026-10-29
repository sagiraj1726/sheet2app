'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { startServer, Client } = require('./helpers');
const samples = require('../src/services/samples');

let srv;
let c;
before(async () => { srv = await startServer(); c = new Client(srv.base); });
after(async () => { await srv.close(); });

async function uploadSamples(names, client = c) {
  const res = await client.upload(await samples.buildWorkbook(names));
  assert.equal(res.status, 201, JSON.stringify(res.data));
  return res.data;
}

test('uploads a multi-sheet workbook and reads every sheet in order', async () => {
  const ov = await uploadSamples(['employees', 'expenses', 'inventory']);
  assert.deepEqual(ov.sheets.map((s) => s.name), ['Employees', 'Monthly Expenses', 'Inventory']);
  assert.deepEqual(ov.sheets.map((s) => s.records), [24, 36, 10]);
  assert.match(ov.id, /^[a-f0-9]{32}$/);
  const sh = await c.get(`/api/workbooks/${ov.id}/sheets/s1`);
  assert.equal(sh.status, 200);
  assert.equal(sh.data.sheet.columns.length, 9);
  assert.equal(sh.data.sheet.rows.length, 24);
});

test('infers sensible field types and keeps IDs / phones as text', async () => {
  const ov = await uploadSamples(['employees', 'inventory', 'leads']);
  const emp = (await c.get(`/api/workbooks/${ov.id}/sheets/s1`)).data.sheet;
  const t = Object.fromEntries(emp.columns.map((x) => [x.header, x.type]));
  assert.equal(t['Employee ID'], 'text');
  assert.equal(t['Employee Name'], 'text');
  assert.equal(t['Department'], 'dropdown');
  assert.equal(t['Joining Date'], 'date');
  assert.equal(t['Salary'], 'currency');
  assert.equal(t['Email'], 'email');
  assert.equal(t['Phone'], 'phone');
  assert.equal(t['Is Active'], 'boolean');
  assert.equal(t['Notes'], 'textarea');
  // leading zeros preserved
  const idCol = emp.columns.find((x) => x.header === 'Employee ID');
  assert.equal(emp.rows[0].v[idCol.id], '0001');
  const inv = (await c.get(`/api/workbooks/${ov.id}/sheets/s2`)).data.sheet;
  assert.equal(inv.columns.find((x) => x.header === 'Stock Value').type, 'readonly');
  assert.equal(inv.columns.find((x) => x.header === 'Category').type, 'dropdown');
  const leads = (await c.get(`/api/workbooks/${ov.id}/sheets/s3`)).data.sheet;
  assert.equal(leads.columns.find((x) => x.header === 'Website').type, 'url');
  assert.equal(leads.columns.find((x) => x.header === 'Survey No').type, 'text');
});

test('handles title rows, duplicate headers, blank headers and blank rows', async () => {
  const ov = await uploadSamples(['messy']);
  const sheet = (await c.get(`/api/workbooks/${ov.id}/sheets/s1`)).data.sheet;
  assert.equal(sheet.headerRow, 3);
  assert.deepEqual(sheet.columns.map((x) => x.header), ['Region', 'Region (2)', 'Column C', 'Sales']);
  assert.equal(sheet.rows.length, 3);
  assert.ok(sheet.notes.some((n) => /Duplicate/.test(n.text)));
  assert.ok(sheet.notes.some((n) => /no name/.test(n.text)));
  assert.ok(sheet.notes.some((n) => /blank row/.test(n.text)));
});

test('lets the user pick a different header row', async () => {
  const ov = await uploadSamples(['messy']);
  const r = await c.post(`/api/workbooks/${ov.id}/sheets/s1/header-row`, { headerRow: 1, baseRevision: ov.revision });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.sheet.headerRow, 1);
  const bad = await c.post(`/api/workbooks/${ov.id}/sheets/s1/header-row`, { headerRow: 2, baseRevision: r.data.revision });
  assert.equal(bad.status, 422);
});

test('rejects invalid files with friendly messages', async () => {
  const txt = await c.upload(Buffer.from('hello world, not a workbook'.repeat(10)), 'a.xlsx');
  assert.equal(txt.status, 415);
  const wrongExt = await c.upload(Buffer.from('x'.repeat(200)), 'a.csv', 'text/csv');
  assert.equal(wrongExt.status, 415);
  const xls = await c.upload(Buffer.from('x'.repeat(200)), 'old.xls', 'application/vnd.ms-excel');
  assert.equal(xls.status, 415);
  assert.match(xls.data.error, /xlsx/);
  const ole = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(300)]);
  const disguised = await c.upload(ole, 'disguised.xlsx');
  assert.equal(disguised.status, 415);
  assert.equal(disguised.data.code, 'LEGACY_XLS');
  const none = await c.req('POST', '/api/workbooks/upload', { form: new FormData() });
  assert.equal(none.status, 400);
  const JSZip = require('jszip');
  const z = new JSZip(); z.file('hello.txt', 'hi'.repeat(100));
  const zipOnly = await c.upload(await z.generateAsync({ type: 'nodebuffer' }), 'zip.xlsx');
  assert.equal(zipOnly.status, 415);
  assert.equal(zipOnly.data.code, 'NOT_XLSX');
  const macro = new JSZip();
  macro.file('[Content_Types].xml', '<x/>'); macro.file('xl/workbook.xml', '<x/>'); macro.file('xl/vbaProject.bin', 'x'.repeat(200));
  const m = await c.upload(await macro.generateAsync({ type: 'nodebuffer' }), 'macro.xlsx');
  assert.equal(m.data.code, 'MACROS');
});

test('an empty worksheet is reported, not crashed on', async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Empty');
  const ws = wb.addWorksheet('Data'); ws.addRow(['A', 'B']); ws.addRow([1, 'x']); ws.addRow([2, 'y']);
  const ov = (await c.upload(Buffer.from(await wb.xlsx.writeBuffer()))).data;
  assert.equal(ov.sheets[0].empty, true);
  assert.equal(ov.sheets[1].records, 2);
  const save = await c.post(`/api/workbooks/${ov.id}/sheets/s1/submit`, { baseRevision: 1, changes: [{ op: 'add', values: {} }] });
  assert.equal(save.status, 409);
});

test('works for completely different schemas without hardcoding', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Zoo');
  ws.addRow(['Animal', 'Weight (kg)', 'Fed Today', 'Enclosure']);
  for (let i = 0; i < 12; i += 1) ws.addRow([`Animal ${i}`, 10 + i * 1.5, i % 2 ? 'Yes' : 'No', ['North', 'South', 'East'][i % 3]]);
  const ov = (await c.upload(Buffer.from(await wb.xlsx.writeBuffer()))).data;
  const cols = (await c.get(`/api/workbooks/${ov.id}/sheets/s1`)).data.sheet.columns;
  assert.deepEqual(cols.map((x) => x.type), ['text', 'decimal', 'boolean', 'dropdown']);
});
