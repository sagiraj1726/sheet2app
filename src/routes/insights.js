'use strict';

const express = require('express');
const { AppError } = require('../middleware/errors');
const workspace = require('../services/workspace.service');
const chart = require('../services/chart.service');
const { effectiveLimits } = require('../config/plans');
const { findSheet, loadOwned } = require('./helpers');

const router = express.Router({ mergeParams: true });

function safeCompute(sheet, cfg) {
  try {
    return chart.computeChart(sheet, cfg);
  } catch (e) {
    if (e instanceof AppError) return { id: cfg.id, ok: false, type: cfg.type, title: cfg.title || 'Chart', reason: e.message, config: cfg };
    throw e;
  }
}

/** GET insights for a sheet: KPIs, auto charts (plan-capped), the user's saved charts, and why some were skipped. */
router.get('/:id/sheets/:sheetId/insights', async (req, res) => {
  const state = await loadOwned(req);
  const sheet = findSheet(state, req.params.sheetId);
  const limits = effectiveLimits();
  const suggestions = chart.suggestCharts(sheet, { maxCharts: limits.autoCharts });
  res.json({
    revision: state.revision,
    sheetId: sheet.id,
    kpis: chart.kpis(sheet),
    quality: chart.qualityOf(sheet),
    charts: suggestions.configs.map((cfg) => safeCompute(sheet, cfg)),
    saved: (sheet.charts || []).map((c) => safeCompute(sheet, { ...c.config, id: c.id })),
    skipped: suggestions.skipped,
    lockedAutoCharts: suggestions.locked,
    options: chart.chartOptions(sheet),
    limits: { customCharts: limits.customCharts, autoCharts: limits.autoCharts },
  });
});

/** Preview a chart config without saving it. */
router.post('/:id/sheets/:sheetId/charts/preview', async (req, res) => {
  const state = await loadOwned(req);
  const sheet = findSheet(state, req.params.sheetId);
  res.json({ chart: chart.computeChart(sheet, { ...(req.body || {}), id: 'preview' }) });
});

/** Save (create or replace) a custom chart on the sheet. Worksheet-level chart configuration. */
router.post('/:id/sheets/:sheetId/charts', async (req, res) => {
  const body = req.body || {};
  const limits = effectiveLimits();
  const out = await workspace.mutate(req.params.id, req.sid, {}, async (draft) => {
    const sheet = findSheet(draft, req.params.sheetId);
    const cfg = chart.normalizeConfig(sheet, body.config || {});
    sheet.charts = sheet.charts || [];
    const existing = body.chartId ? sheet.charts.find((c) => c.id === body.chartId) : null;
    if (!existing && sheet.charts.length >= limits.customCharts) {
      throw new AppError(402, 'PLAN_LIMIT', `Your plan allows ${limits.customCharts} saved custom charts per sheet.`, { upgrade: true, limit: 'customCharts', max: limits.customCharts });
    }
    const id = existing ? existing.id : `u${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`;
    const entry = { id, config: cfg };
    if (existing) sheet.charts[sheet.charts.indexOf(existing)] = entry; else sheet.charts.push(entry);
    return { id };
  });
  const sheet = findSheet(out.state, req.params.sheetId);
  const saved = sheet.charts.find((c) => c.id === out.result.id);
  res.status(201).json({ chart: safeCompute(sheet, { ...saved.config, id: saved.id }) });
});

router.delete('/:id/sheets/:sheetId/charts/:chartId', async (req, res) => {
  await workspace.mutate(req.params.id, req.sid, {}, async (draft) => {
    const sheet = findSheet(draft, req.params.sheetId);
    const before = (sheet.charts || []).length;
    sheet.charts = (sheet.charts || []).filter((c) => c.id !== req.params.chartId);
    if (sheet.charts.length === before) throw new AppError(404, 'NOT_FOUND', 'Chart not found.');
  });
  res.json({ deleted: true });
});

module.exports = router;
