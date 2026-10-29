'use strict';

const express = require('express');
const excel = require('../services/excel.service');
const workspace = require('../services/workspace.service');
const { findSheet, loadOwned } = require('./helpers');

const router = express.Router();

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function downloadName(fileName, suffix, ext) {
  const base = workspace.safeFileName(fileName).replace(/\.xlsx$/i, '');
  return `${base}${suffix}.${ext}`;
}

function sendAttachment(res, name, type, body) {
  res.set({
    'Content-Type': type,
    // filename is sanitised by safeFileName(); encode again for the RFC 5987 form
    'Content-Disposition': `attachment; filename="${name.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.send(body);
}

/** Always built from the LATEST saved state, never the original upload. */
router.get('/:id/export.xlsx', async (req, res) => {
  const state = await loadOwned(req);
  const original = await workspace.originalBuffer(req.params.id, req.sid);
  const buffer = await excel.buildExport(original, state);
  sendAttachment(res, downloadName(state.fileName, '-updated', 'xlsx'), XLSX_MIME, buffer);
});

router.get('/:id/sheets/:sheetId/export.csv', async (req, res) => {
  const state = await loadOwned(req);
  const sheet = findSheet(state, req.params.sheetId);
  const safeSheet = sheet.name.replace(/[^\w\- ]/g, '_').slice(0, 40);
  sendAttachment(res, downloadName(state.fileName, `-${safeSheet}`, 'csv'), 'text/csv; charset=utf-8', excel.sheetToCsv(sheet));
});

module.exports = router;
