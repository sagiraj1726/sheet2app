'use strict';

const { AppError, notFound } = require('../middleware/errors');
const workspace = require('../services/workspace.service');
const chart = require('../services/chart.service');
const { effectiveLimits, getPlan } = require('../config/plans');

const SHEET_ID_RE = /^s\d{1,4}$/;

function findSheet(state, sheetId) {
  if (!SHEET_ID_RE.test(String(sheetId))) throw notFound('Sheet not found.');
  const sheet = state.sheets.find((s) => s.id === sheetId);
  if (!sheet) throw notFound('Sheet not found.');
  return sheet;
}

/** Client-facing sheet model (rows compacted, internal export bookkeeping removed). */
function sheetPayload(sheet) {
  return {
    id: sheet.id,
    name: sheet.name,
    hidden: Boolean(sheet.hidden),
    empty: Boolean(sheet.empty),
    headerRow: sheet.headerRow,
    headerUncertain: Boolean(sheet.headerUncertain),
    notes: sheet.notes || [],
    stats: sheet.stats || {},
    columns: sheet.columns,
    rows: sheet.rows.map((r) => ({ id: r.id, v: r.v, fx: r.f ? Object.keys(r.f) : undefined })),
    charts: (sheet.charts || []).map((c) => ({ id: c.id, config: c.config })),
  };
}

function overview(state) {
  const limits = effectiveLimits();
  return {
    id: state.id,
    fileName: state.fileName,
    revision: state.revision,
    savedAt: state.savedAt || null,
    saves: state.saves || 0,
    plan: getPlan().id,
    limits,
    sheets: state.sheets.map((s) => ({
      id: s.id,
      name: s.name,
      hidden: Boolean(s.hidden),
      empty: Boolean(s.empty),
      records: s.rows.length,
      columns: s.columns.length,
      quality: chart.qualityOf(s),
      warnings: (s.notes || []).filter((n) => n.level === 'warn').length,
      notes: s.notes || [],
      headerUncertain: Boolean(s.headerUncertain),
    })),
  };
}

async function loadOwned(req) {
  return workspace.read(req.params.id, req.sid);
}

module.exports = { findSheet, sheetPayload, overview, loadOwned, SHEET_ID_RE, AppError };
