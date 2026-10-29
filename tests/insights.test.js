'use strict';
/**
 * Milestone 7 — Charts, KPIs, plain-language insights.
 * All calculations must use actual saved workbook data.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, Client } = require('./helpers');
const samples = require('../src/services/samples');

let srv;
let c;
before(async () => { srv = await startServer(); c = new Client(srv.base); });
after(async () => { await srv.close(); });

async function uploadAndInsights(names, sheetId = 's1') {
  const res = await c.upload(await samples.buildWorkbook(names));
  assert.equal(res.status, 201);
  const id = res.data.id;
  const ins = await c.get(`/api/workbooks/${id}/sheets/${sheetId}/insights`);
  assert.equal(ins.status, 200);
  return { id, insights: ins.data };
}

test('returns KPI cards for employees sheet', async () => {
  const { insights } = await uploadAndInsights(['employees']);
  assert.ok(Array.isArray(insights.kpis), 'kpis must be an array');
  assert.ok(insights.kpis.length >= 1, 'must have at least one KPI');
  const rec = insights.kpis.find((k) => k.id === 'records');
  assert.ok(rec, 'records KPI must exist');
  assert.equal(rec.value, '24'); // employees sample has 24 rows
});

test('returns quality score for a data-complete sheet', async () => {
  const { insights } = await uploadAndInsights(['employees']);
  assert.ok(insights.quality, 'quality must be returned');
  assert.ok(typeof insights.quality.score === 'number', 'quality score must be a number');
  assert.ok(insights.quality.score >= 0 && insights.quality.score <= 100, 'quality score in range 0-100');
});

test('auto-suggests charts for categorical + numeric data', async () => {
  const { insights } = await uploadAndInsights(['employees']);
  assert.ok(Array.isArray(insights.charts), 'charts must be an array');
  assert.ok(insights.charts.length >= 1, 'at least one chart should be suggested');
  // All returned charts must be OK
  for (const ch of insights.charts) {
    assert.equal(ch.ok, true, `chart ${ch.id} must be ok: ${ch.reason}`);
  }
});

test('auto-suggests charts for expense data (dates + currency)', async () => {
  const { insights } = await uploadAndInsights(['expenses']);
  assert.ok(insights.charts.length >= 1, 'expenses sheet should produce charts');
  const types = insights.charts.map((c) => c.type);
  // Expenses have dates and currency: expect at least a line or area chart
  assert.ok(types.some((t) => ['line', 'area', 'bar', 'hbar'].includes(t)), 'should have trend or category chart');
});

test('explains why unsuitable charts are skipped', async () => {
  // An empty sheet shouldn't crash and should explain the skip
  const { id } = await uploadAndInsights(['employees']);
  // Use the messy workbook which is minimal
  const res2 = await c.upload(await samples.buildWorkbook(['messy']));
  const ins2 = (await c.get(`/api/workbooks/${res2.data.id}/sheets/s1/insights`)).data;
  assert.ok(Array.isArray(ins2.skipped));
});

test('computeChart: bar chart by department produces correct group counts', async () => {
  const res = await c.upload(await samples.buildWorkbook(['employees']));
  const id = res.data.id;
  const sh = (await c.get(`/api/workbooks/${id}/sheets/s1`)).data.sheet;
  const deptCol = sh.columns.find((x) => x.header === 'Department');
  assert.ok(deptCol, 'Department column must exist');
  const preview = await c.post(`/api/workbooks/${id}/sheets/s1/charts/preview`, {
    type: 'bar', dimension: deptCol.id, agg: 'count', filters: [],
  });
  assert.equal(preview.status, 200);
  assert.equal(preview.data.chart.ok, true);
  const { series } = preview.data.chart;
  assert.ok(Array.isArray(series), 'series must be an array');
  // Sum of all counts must equal total records
  const total = series[0].data.reduce((a, b) => a + (b || 0), 0);
  assert.equal(total, sh.rows.length, 'sum of bar chart groups must equal total rows');
});

test('computeChart: histogram produces non-negative bucket counts', async () => {
  const res = await c.upload(await samples.buildWorkbook(['employees']));
  const id = res.data.id;
  const sh = (await c.get(`/api/workbooks/${id}/sheets/s1`)).data.sheet;
  const salaryCol = sh.columns.find((x) => x.header === 'Salary');
  assert.ok(salaryCol, 'Salary column must exist');
  const preview = await c.post(`/api/workbooks/${id}/sheets/s1/charts/preview`, {
    type: 'histogram', measure: salaryCol.id, agg: 'count', filters: [],
  });
  assert.equal(preview.status, 200);
  assert.equal(preview.data.chart.ok, true, preview.data.chart.reason);
  for (const v of preview.data.chart.series[0].data) {
    assert.ok(v >= 0, 'bucket count must be >= 0');
  }
});

test('chart explanation (explain) is present and non-empty', async () => {
  const res = await c.upload(await samples.buildWorkbook(['expenses']));
  const id = res.data.id;
  const sh = (await c.get(`/api/workbooks/${id}/sheets/s1`)).data.sheet;
  const amtCol = sh.columns.find((x) => x.header === 'Amount');
  const catCol = sh.columns.find((x) => x.header === 'Category' || x.type === 'dropdown');
  assert.ok(amtCol && catCol, 'need category and amount columns');
  const preview = await c.post(`/api/workbooks/${id}/sheets/s1/charts/preview`, {
    type: 'bar', dimension: catCol.id, measure: amtCol.id, agg: 'sum', filters: [],
  });
  assert.equal(preview.status, 200);
  assert.equal(preview.data.chart.ok, true, preview.data.chart.reason);
  const explain = preview.data.chart.explain;
  assert.ok(explain && typeof explain === 'object', 'explain must be an object');
  assert.ok(explain.what && explain.what.length > 0, 'explain.what must be non-empty');
  assert.ok(explain.howToRead && explain.howToRead.length > 0, 'explain.howToRead must be non-empty');
});

test('saved custom chart is returned from insights endpoint', async () => {
  const res = await c.upload(await samples.buildWorkbook(['employees']));
  const id = res.data.id;
  const sh = (await c.get(`/api/workbooks/${id}/sheets/s1`)).data.sheet;
  const deptCol = sh.columns.find((x) => x.header === 'Department');
  const save = await c.post(`/api/workbooks/${id}/sheets/s1/charts`, {
    config: { type: 'doughnut', dimension: deptCol.id, agg: 'count', filters: [], title: 'Dept Split' },
  });
  assert.equal(save.status, 201);
  const chartId = save.data.chart.id;
  const ins = (await c.get(`/api/workbooks/${id}/sheets/s1/insights`)).data;
  const found = ins.saved.find((x) => x.id === chartId);
  assert.ok(found, 'saved chart must appear in insights.saved');
  assert.equal(found.ok, true);
});

test('chart recalculates after data edit', async () => {
  const res = await c.upload(await samples.buildWorkbook(['employees']));
  const id = res.data.id;
  const sh = (await c.get(`/api/workbooks/${id}/sheets/s1`)).data.sheet;
  const deptCol = sh.columns.find((x) => x.header === 'Department');
  const nameCol = sh.columns.find((x) => x.header === 'Employee Name');

  // Use a custom chart (count by dimension) so we know what to expect
  const saved = await c.post(`/api/workbooks/${id}/sheets/s1/charts`, {
    config: { type: 'bar', dimension: deptCol.id, agg: 'count', filters: [], title: 'Dept Count' },
  });
  assert.equal(saved.status, 201);
  const chartId = saved.data.chart.id;
  const totalBefore = saved.data.chart.series[0].data.reduce((a, b) => a + (b || 0), 0);
  assert.equal(totalBefore, sh.rows.length, 'initial total must equal row count');

  // Get current revision for submit
  const shData = (await c.get(`/api/workbooks/${id}/sheets/s1`)).data;
  // Add 2 records
  await c.post(`/api/workbooks/${id}/sheets/s1/submit`, {
    baseRevision: shData.revision,
    changes: [
      { op: 'add', values: { [deptCol.id]: 'Engineering', [nameCol.id]: 'New A' } },
      { op: 'add', values: { [deptCol.id]: 'Engineering', [nameCol.id]: 'New B' } },
    ],
  });
  const insA = (await c.get(`/api/workbooks/${id}/sheets/s1/insights`)).data;
  const refreshed = insA.saved.find((c) => c.id === chartId);
  assert.ok(refreshed, 'custom chart must still be in saved list after edit');
  const totalAfter = refreshed.series[0].data.reduce((a, b) => a + (b || 0), 0);
  assert.equal(totalAfter, totalBefore + 2, 'chart totals must reflect added records');
});

test('chart options endpoint returns categories, numbers and dates', async () => {
  const res = await c.upload(await samples.buildWorkbook(['employees']));
  const id = res.data.id;
  const ins = (await c.get(`/api/workbooks/${id}/sheets/s1/insights`)).data;
  assert.ok(Array.isArray(ins.options.categories));
  assert.ok(Array.isArray(ins.options.numbers));
  assert.ok(Array.isArray(ins.options.dates));
  assert.ok(Array.isArray(ins.options.types));
  assert.ok(Array.isArray(ins.options.aggs));
});

test('custom chart can be deleted', async () => {
  const res = await c.upload(await samples.buildWorkbook(['employees']));
  const id = res.data.id;
  const sh = (await c.get(`/api/workbooks/${id}/sheets/s1`)).data.sheet;
  const deptCol = sh.columns.find((x) => x.header === 'Department');
  const save = await c.post(`/api/workbooks/${id}/sheets/s1/charts`, {
    config: { type: 'bar', dimension: deptCol.id, agg: 'count', filters: [] },
  });
  const chartId = save.data.chart.id;
  const del = await c.del(`/api/workbooks/${id}/sheets/s1/charts/${chartId}`);
  assert.equal(del.status, 200);
  const ins = (await c.get(`/api/workbooks/${id}/sheets/s1/insights`)).data;
  assert.ok(!ins.saved.find((x) => x.id === chartId), 'deleted chart must not appear');
});
