'use strict';

const express = require('express');
const { AppError } = require('../middleware/errors');
const workspace = require('../services/workspace.service');
const excel = require('../services/excel.service');
const schema = require('../services/schema.service');
const { effectiveLimits } = require('../config/plans');
const { findSheet, sheetPayload, overview, loadOwned } = require('./helpers');

const router = express.Router();

router.get('/', async (req, res) => {
  res.json({ workbooks: await workspace.listOwned(req.sid) });
});

router.get('/:id', async (req, res) => {
  const state = await loadOwned(req);
  res.json({ ...overview(state), undo: await workspace.undoInfo(state.id, req.sid) });
});

router.get('/:id/sheets/:sheetId', async (req, res) => {
  const state = await loadOwned(req);
  const sheet = findSheet(state, req.params.sheetId);
  res.json({ revision: state.revision, sheet: sheetPayload(sheet) });
});

router.delete('/:id', async (req, res) => {
  await workspace.destroyOwned(req.params.id, req.sid);
  res.json({ deleted: true });
});

/** Re-read one sheet using a different header row. Discards that sheet's edits (client confirms first). */
router.post('/:id/sheets/:sheetId/header-row', async (req, res) => {
  const row = Number(req.body && req.body.headerRow);
  if (!Number.isInteger(row) || row < 1 || row > 1000000) throw new AppError(422, 'VALIDATION', 'Enter a valid row number.');
  const buffer = await workspace.originalBuffer(req.params.id, req.sid);
  const { state } = await workspace.mutate(req.params.id, req.sid, { baseRevision: req.body.baseRevision }, async (draft) => {
    const idx = draft.sheets.findIndex((s) => s.id === req.params.sheetId);
    if (idx === -1) throw new AppError(404, 'NOT_FOUND', 'Sheet not found.');
    draft.sheets[idx] = await excel.reparseSheet(buffer, draft.sheets[idx], row, effectiveLimits());
    if (draft.sheets[idx].empty) throw new AppError(422, 'VALIDATION', `Row ${row} cannot be used as the header row because it has no column names.`);
  });
  res.json({ ...overview(state), sheet: sheetPayload(findSheet(state, req.params.sheetId)) });
});

router.post('/:id/undo', async (req, res) => {
  const { state, label, sheetId } = await workspace.undo(req.params.id, req.sid);
  res.json({ ...overview(state), undone: label, sheet: sheetPayload(findSheet(state, sheetId)), undo: await workspace.undoInfo(state.id, req.sid) });
});

// --------------------------------------------------------------------------- records (batch submit)

const MAX_CHANGES = 5000;

/**
 * POST /:id/sheets/:sheetId/submit
 * body: { baseRevision, changes: [{op:'add',tempId,values}, {op:'update',id,values}, {op:'delete',id}] }
 * Atomic: every change is validated first; nothing is saved unless all pass.
 */
router.post('/:id/sheets/:sheetId/submit', async (req, res) => {
  const body = req.body || {};
  const changes = body.changes;
  if (!Array.isArray(changes) || !changes.length) throw new AppError(400, 'NO_CHANGES', 'There are no changes to save.');
  if (changes.length > MAX_CHANGES) throw new AppError(413, 'TOO_LARGE', 'Too many changes in one save.');
  if (!Number.isInteger(body.baseRevision)) throw new AppError(400, 'BAD_REQUEST', 'Reload the page and try again.');

  const limits = effectiveLimits();
  const fieldErrors = {};
  const summary = { added: 0, updated: 0, deleted: 0 };

  const out = await workspace.mutate(
    req.params.id, req.sid,
    { baseRevision: body.baseRevision, undoLabel: 'Save changes', sheetId: req.params.sheetId },
    async (draft) => {
      const sheet = findSheet(draft, req.params.sheetId);
      if (sheet.empty) throw new AppError(409, 'EMPTY_SHEET', 'This sheet has no table to edit.');
      const byId = new Map(sheet.rows.map((r) => [r.id, r]));
      const colMap = new Map(sheet.columns.map((c) => [c.id, c]));
      const deletes = new Set();
      const adds = [];
      const updates = [];

      changes.forEach((ch, i) => {
        const key = ch && (ch.id || ch.tempId) ? String(ch.id || ch.tempId) : `#${i}`;
        const err = (field, msg) => { fieldErrors[key] = fieldErrors[key] || {}; fieldErrors[key][field] = msg; };
        if (!ch || typeof ch !== 'object') return err('_', 'Invalid change.');
        if (ch.op === 'delete') {
          if (!byId.has(ch.id)) return err('_', 'This record no longer exists.');
          return deletes.add(ch.id);
        }
        if (ch.op !== 'add' && ch.op !== 'update') return err('_', 'Unknown change.');
        const values = ch.values && typeof ch.values === 'object' ? ch.values : {};
        const clean = {};
        for (const id of Object.keys(values)) {
          const col = colMap.get(id);
          if (!col) { err(id, 'This column no longer exists.'); continue; }
          if (col.readOnly || col.type === 'readonly') {
            if (ch.op === 'update') { const cur = byId.get(ch.id); if (cur && schema.sameValue(cur.v[id], values[id])) continue; }
            err(id, 'This field is read-only.');
            continue;
          }
          const r = schema.coerceValue(col, values[id]);
          if (r.error) err(id, r.error); else clean[id] = r.value;
        }
        if (ch.op === 'add') {
          // columns not provided still need required / default handling
          for (const col of sheet.columns) {
            if (col.id in clean || col.readOnly || col.type === 'readonly') continue;
            const r = col.defaultValue !== null && col.defaultValue !== undefined ? { value: col.defaultValue } : schema.coerceValue(col, null);
            if (r.error) err(col.id, r.error); else clean[col.id] = r.value;
          }
          adds.push({ key, clean, tempId: ch.tempId });
        } else {
          const cur = byId.get(ch.id);
          if (!cur) return err('_', 'This record no longer exists.');
          // A required column that is now blank on an existing record also fails (coerce handles it).
          updates.push({ cur, clean });
        }
      });

      if (Object.keys(fieldErrors).length) {
        throw new AppError(422, 'VALIDATION', 'Some values need fixing before they can be saved.', { fieldErrors });
      }
      if (sheet.rows.length - deletes.size + adds.length > limits.maxRowsPerSheet) {
        throw new AppError(402, 'PLAN_LIMIT', `Your plan allows up to ${limits.maxRowsPerSheet.toLocaleString('en-IN')} records per sheet.`, { upgrade: true, limit: 'maxRowsPerSheet', max: limits.maxRowsPerSheet });
      }

      for (const { cur, clean } of updates) {
        let changed = false;
        for (const [cid, val] of Object.entries(clean)) {
          if (!schema.sameValue(cur.v[cid], val)) {
            cur.v[cid] = val;
            changed = true;
            if (cur.f && cur.f[cid]) delete cur.f[cid]; // user overwrote a formula cell with a value
            if (cur.h && cur.h[cid]) delete cur.h[cid];
          }
        }
        if (changed) summary.updated += 1;
      }
      if (deletes.size) {
        sheet.rows = sheet.rows.filter((r) => !deletes.has(r.id));
        summary.deleted = deletes.size;
      }
      const created = [];
      for (const a of adds) {
        const rec = { id: `r${sheet.nextRowNo++}`, src: null, v: {} };
        for (const col of sheet.columns) rec.v[col.id] = a.clean[col.id] ?? null;
        sheet.rows.push(rec);
        created.push({ tempId: a.tempId, id: rec.id });
        summary.added += 1;
      }
      if (!summary.added && !summary.updated && !summary.deleted) {
        throw new AppError(409, 'NO_CHANGES', 'Nothing was different, so nothing was saved.');
      }
      return { created };
    },
  );
  res.json({ ...overview(out.state), summary, created: out.result.created, sheet: sheetPayload(findSheet(out.state, req.params.sheetId)), undo: await workspace.undoInfo(out.state.id, req.sid) });
});

// --------------------------------------------------------------------------- schema

router.put('/:id/sheets/:sheetId/schema', async (req, res) => {
  const body = req.body || {};
  if (!Number.isInteger(body.baseRevision)) throw new AppError(400, 'BAD_REQUEST', 'Reload the page and try again.');
  const limits = effectiveLimits();
  let summary;
  const out = await workspace.mutate(
    req.params.id, req.sid,
    { baseRevision: body.baseRevision, undoLabel: 'Change fields', sheetId: req.params.sheetId },
    async (draft) => {
      const sheet = findSheet(draft, req.params.sheetId);
      if (sheet.empty) throw new AppError(409, 'EMPTY_SHEET', 'This sheet has no table to configure.');
      summary = schema.applySchemaUpdate(sheet, body, { maxColumns: limits.maxColumns });
    },
  );
  res.json({ ...overview(out.state), summary, sheet: sheetPayload(findSheet(out.state, req.params.sheetId)), undo: await workspace.undoInfo(out.state.id, req.sid) });
});

module.exports = router;
