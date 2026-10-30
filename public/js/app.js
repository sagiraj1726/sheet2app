/* Workspace controller: state, unsaved edits, save/undo/download, overview, navigation. */
(function () {
  'use strict';
  const S = window.S2A;
  const { $, $$, h, api, icon, toast } = S;

  const TABS = [['overview', 'Overview', 'home'], ['data', 'Data', 'sheet'], ['form', 'Form', 'form'], ['fields', 'Fields', 'cog'], ['insights', 'Insights', 'chart']];
  const state = {
    id: null, wb: null, sheets: {}, sheetId: null, tab: 'overview', edits: {}, views: {}, undo: [],
    insights: false, saving: false, fieldsDirty: false, counter: 0, menuOpen: false, visited: {}, downloaded: false, saveFailed: false,
    changeLog: [],   // accumulates {sheetName, added, updated, deleted, fields} per save
  };
  try { state.insights = localStorage.getItem('s2a_insights') === '1'; } catch { /* ignore */ }

  // ------------------------------------------------------------------ edit bookkeeping
  const E = (sid) => (state.edits[sid] = state.edits[sid] || { map: {}, order: [], errors: {} });
  const cur = () => state.sheets[state.sheetId];
  const hasEdits = (sid) => state.edits[sid] && Object.keys(state.edits[sid].map).length > 0;
  const countEdits = () => Object.values(state.edits).reduce((a, e) => a + Object.keys(e.map).length, 0);
  const dirtySheetIds = () => Object.keys(state.edits).filter(hasEdits);
  const hasUnsaved = () => countEdits() > 0;
  const view = () => (state.views[state.sheetId] = state.views[state.sheetId] || {});
  const sheetName = (sid) => (state.wb.sheets.find((s) => s.id === sid) || {}).name || sid;
  const F = () => S.fields;

  function clearEdits(sid) { delete state.edits[sid]; }

  function effective() {
    const s = cur();
    const ed = E(s.id);
    const out = [];
    for (const r of s.rows) {
      const e = ed.map[r.id];
      if (!e) { out.push({ key: r.id, v: r.v, state: 'saved' }); continue; }
      out.push({ key: r.id, v: e.values ? { ...r.v, ...e.values } : r.v, state: e.deleted ? 'deleted' : 'edited', changed: new Set(Object.keys(e.values || {})) });
    }
    for (const k of ed.order) { const e = ed.map[k]; if (e) out.push({ key: k, v: e.values, state: e.deleted ? 'deleted' : 'new', changed: new Set(Object.keys(e.values)) }); }
    return out;
  }

  function getValue(key, cid) {
    const s = cur(); const e = E(s.id).map[key];
    if (e && e.isNew) return e.values[cid];
    if (e && e.values && cid in e.values) return e.values[cid];
    const r = s.rows.find((x) => x.id === key);
    return r ? r.v[cid] : undefined;
  }

  function setValue(key, cid, val) {
    const s = cur(); const ed = E(s.id);
    let e = ed.map[key];
    if (!e) {
      const base = s.rows.find((r) => r.id === key);
      if (!base) return;
      e = ed.map[key] = { values: {} };
    }
    if (e.isNew) e.values[cid] = val;
    else {
      const base = s.rows.find((r) => r.id === key);
      const b = base ? base.v[cid] : null;
      const same = (F().isEmpty(b) && F().isEmpty(val)) || String(b) === String(val);
      if (same) delete e.values[cid]; else e.values[cid] = val;
      if (!Object.keys(e.values).length && !e.deleted) delete ed.map[key];
    }
    if (ed.errors[key]) delete ed.errors[key][cid];
    refreshChrome();
  }

  function addRecord() {
    const s = cur(); const ed = E(s.id);
    const key = 'n' + (++state.counter);
    const values = {};
    for (const c of s.columns) values[c.id] = c.defaultValue === undefined ? null : c.defaultValue;
    ed.map[key] = { isNew: true, values };
    ed.order.push(key);
    refreshChrome();
    return key;
  }

  function deleteRecord(key) {
    const ed = E(cur().id); const e = ed.map[key];
    if (!e) { ed.map[key] = { values: {}, deleted: true }; } else if (e.isNew) { delete ed.map[key]; ed.order = ed.order.filter((k) => k !== key); } else e.deleted = true;
    delete ed.errors[key];
    refreshChrome();
  }
  function restoreRecord(key) {
    const ed = E(cur().id); const e = ed.map[key];
    if (!e) return;
    e.deleted = false;
    if (!e.isNew && !Object.keys(e.values || {}).length) delete ed.map[key];
    refreshChrome();
  }
  function discardRecord(key) {
    const ed = E(cur().id); const e = ed.map[key];
    if (e && !e.isNew) { delete ed.map[key]; delete ed.errors[key]; }
    refreshChrome();
  }

  async function confirmDelete(rec) {
    const s = cur();
    // new (unsaved) records: confirm silently since they've never been saved
    if (rec.state === 'new') return true;
    const cols = s.columns.filter((c) => c.visible !== false && c.type !== 'readonly' && !F().isEmpty(rec.v[c.id]));
    const rows = cols.map((c) => h('div.rec-preview-row', {},
      h('span.rpr-label', {}, c.label),
      h('span.rpr-value', {}, F().display(c, rec.v[c.id]) || String(rec.v[c.id]))));
    return S.confirmDialog({
      title: 'Delete this record?', danger: true, confirmText: 'Delete', cancelText: 'Cancel',
      body: h('div', {},
        h('p', { style: 'margin-bottom:12px' }, 'The following record will be ', h('b', { style: 'color:var(--danger)' }, 'deleted'), ' when you save:'),
        h('div.rec-preview', {}, ...rows),
        h('p.small.muted', { style: 'margin-top:10px' }, 'It is removed from your workbook on the next Save. Until then you can restore it from the table.')),
    });
  }

  async function showEditPreview(rec) {
    const s = cur();
    const ed = E(s.id).map[rec.key];
    // if no unsaved edits yet, just open the form
    if (!ed || !ed.values || !Object.keys(ed.values).length) { ctx.openRecord(rec.key); return; }

    const changedCols = s.columns.filter((c) => c.id in ed.values);
    const rows = changedCols.map((c) => {
      const oldVal = s.rows.find((r) => r.id === rec.key);
      const oldRaw = oldVal ? oldVal.v[c.id] : null;
      const newRaw = ed.values[c.id];
      const oldTxt = F().isEmpty(oldRaw) ? h('span.rpr-empty', {}, '(empty)') : h('span', {}, F().display(c, oldRaw));
      const newTxt = F().isEmpty(newRaw) ? h('span.rpr-empty', {}, '(empty)') : h('span', {}, F().display(c, newRaw));
      return h('div.rec-preview-row', {},
        h('span.rpr-label', {}, c.label),
        h('span.rpr-diff', {},
          h('span.rpr-old', {}, oldTxt),
          h('span.rpr-arrow', { html: icon('right') }),
          h('span.rpr-new', {}, newTxt)));
    });

    const goEdit = await S.confirmDialog({
      title: `Unsaved edits on this record`,
      confirmText: 'Continue editing',
      cancelText: 'Close',
      body: h('div', {},
        h('p', { style: 'margin-bottom:12px' }, h('b', {}, String(changedCols.length)), ` field${changedCols.length === 1 ? '' : 's'} changed (not yet saved):`),
        h('div.rec-preview', {}, ...rows)),
    });
    if (goEdit) ctx.openRecord(rec.key);
  }

  // ------------------------------------------------------------------ validation + save
  function validateSheet(sid) {
    const s = state.sheets[sid]; const ed = E(sid);
    ed.errors = {};
    let bad = 0; let firstKey = null;
    for (const [key, e] of Object.entries(ed.map)) {
      if (e.deleted) continue;
      const cols = e.isNew ? s.columns : s.columns.filter((c) => c.id in (e.values || {}));
      for (const c of cols) {
        const msg = F().validate(c, e.values[c.id]);
        if (msg) { (ed.errors[key] = ed.errors[key] || {})[c.id] = msg; bad += 1; firstKey = firstKey || key; }
      }
    }
    return { bad, firstKey };
  }

  function buildChanges(sid) {
    const s = state.sheets[sid]; const ed = E(sid); const out = [];
    const writable = s.columns.filter((c) => !c.readOnly && c.type !== 'readonly');
    const ids = new Set(writable.map((c) => c.id));
    for (const [key, e] of Object.entries(ed.map)) {
      if (e.deleted) { if (!e.isNew) out.push({ op: 'delete', id: key }); continue; }
      const vals = {};
      for (const [cid, v] of Object.entries(e.values || {})) if (ids.has(cid)) vals[cid] = v;
      if (e.isNew) out.push({ op: 'add', tempId: key, values: vals });
      else if (Object.keys(vals).length) out.push({ op: 'update', id: key, values: vals });
    }
    return out;
  }

  function applyResponse(res) {
    const { sheet, undo, summary, created, undone, ...ov } = res;
    state.wb = { ...state.wb, ...ov };
    if (sheet) state.sheets[sheet.id] = sheet;
    if (undo) state.undo = undo;
    return { summary, created, undone };
  }

  function updateSaveState() {
    const el = $('#save-state');
    if (!el) return;
    const n = countEdits();
    el.className = 'save-state' + (state.saving ? ' saving' : state.saveFailed ? ' error' : n || state.fieldsDirty ? ' dirty' : '');
    el.replaceChildren(h('span', { html: icon(state.saving ? 'refresh' : n || state.fieldsDirty || state.saveFailed ? 'alert' : 'check', state.saving ? 'spin' : '') }),
      document.createTextNode(state.saving ? 'Saving…' : state.saveFailed ? 'Not saved' : n ? `${n} unsaved change${n === 1 ? '' : 's'}` : state.fieldsDirty ? 'Unapplied field changes' : state.wb && state.wb.saves ? 'All changes saved' : 'No changes yet'));
  }

  function renderDirty() {
    const host = $('#dirty');
    const n = countEdits();
    if (!n) { host.replaceChildren(); return; }
    const sheets = dirtySheetIds();
    host.replaceChildren(h('div.dirty-bar', { role: 'region', 'aria-label': 'Unsaved changes' },
      h('span', {}, h('b', {}, String(n)), ` unsaved change${n === 1 ? '' : 's'}`, sheets.length > 1 ? ` in ${sheets.length} sheets` : ` in “${sheetName(sheets[0])}”`),
      h('button.btn.btn-ghost.btn-sm', { type: 'button', disabled: state.saving || null, onclick: discardAll }, 'Discard'),
      h('button.btn.btn-primary.btn-sm', { type: 'button', disabled: state.saving || null, onclick: () => saveAll() }, h('span', { html: icon('check') }), state.saving ? ' Saving…' : ' Save changes')));
  }

  function refreshChrome() { updateSaveState(); renderDirty(); renderSidebar(); renderTabs(); }

  async function discardAll() {
    const ok = await S.confirmDialog({ title: 'Discard all unsaved changes?', danger: true, confirmText: 'Discard changes', body: 'Records you added, edited or marked for deletion will go back to how they were last saved.' });
    if (!ok) return;
    state.edits = {}; state.saveFailed = false;
    renderAll();
  }

  async function saveAll() {
    if (state.saving) return false;
    const sids = dirtySheetIds();
    if (!sids.length) return true;
    let first = null;
    for (const sid of sids) { const r = validateSheet(sid); if (r.bad && !first) first = { sid, key: r.firstKey }; }
    if (first) {
      state.saveFailed = false;
      await gotoRecord(first.sid, first.key);
      toast('err', 'Please fix the highlighted fields', 'Nothing was saved yet.');
      return false;
    }
    state.saving = true; state.saveFailed = false; refreshChrome();
    const total = { added: 0, updated: 0, deleted: 0 };
    try {
      for (const sid of sids) {
        const changes = buildChanges(sid);
        if (!changes.length) { clearEdits(sid); continue; }
        let res;
        try {
          res = await api.post(`/api/workbooks/${state.id}/sheets/${sid}/submit`, { baseRevision: state.wb.revision, changes });
        } catch (e) {
          if (e.code === 'NO_CHANGES') { clearEdits(sid); continue; }
          throw Object.assign(e, { sid });
        }
        const info = applyResponse(res);
        const ed = E(sid);
        for (const c of info.created || []) {
          const v = state.views[sid];
          if (v && v.selected === c.tempId) v.selected = c.id;
        }
        clearEdits(sid);
        state.views[sid] && (state.views[sid].draft = null);
        for (const k of Object.keys(total)) total[k] += (info.summary && info.summary[k]) || 0;
        // record in change log
        if (info.summary && (info.summary.added || info.summary.updated || info.summary.deleted)) {
          state.changeLog.push({ at: Date.now(), sheetName: sheetName(sid), type: 'records', ...info.summary });
        }
      }
      const parts = [];
      if (total.added) parts.push(`${total.added} added`); if (total.updated) parts.push(`${total.updated} updated`); if (total.deleted) parts.push(`${total.deleted} deleted`);
      toast('ok', 'Saved', parts.length ? parts.join(', ') + '. Your workbook is up to date and ready to download.' : 'Everything is up to date.');
      return true;
    } catch (e) {
      state.saveFailed = true;
      await handleSaveError(e);
      return false;
    } finally {
      state.saving = false;
      renderAll();
    }
  }

  async function handleSaveError(e) {
    if (e.code === 'VALIDATION' && e.data.fieldErrors && e.sid) {
      const ed = E(e.sid); ed.errors = {};
      let firstKey = null;
      for (const [key, fields] of Object.entries(e.data.fieldErrors)) { ed.errors[key] = fields; firstKey = firstKey || key; }
      await gotoRecord(e.sid, firstKey);
      toast('err', 'The server could not save', 'Fix the highlighted fields and try again. Nothing was changed.');
    } else if (e.code === 'STALE') {
      const reload = await S.confirmDialog({ title: 'This workbook changed elsewhere', confirmText: 'Reload latest', cancelText: 'Keep editing', body: 'It was saved in another tab or window. To avoid overwriting that work, reload the latest version. Your unsaved edits here would be lost.' });
      if (reload) location.reload();
    } else if (e.code === 'PLAN_LIMIT') upgradeNotice(e);
    else if (e.code === 'EXPIRED' || e.status === 404) { toast('err', 'Workbook not found', 'It may have expired. Upload your file again.'); }
    else toast('err', 'Not saved', e.message + ' Your edits are still here; try again.');
  }

  function upgradeNotice(e) {
    S.alertDialog({ title: 'You have reached a plan limit', confirmText: 'Got it', body: h('div', {}, h('p', {}, e.message), h('p.small.muted', {}, 'Paid plans are not open yet. You can see what each plan includes on the pricing page.'), h('a.btn.btn-sm', { href: '/pricing', target: '_blank', rel: 'noopener' }, 'View plans')) });
  }

  async function gotoRecord(sid, key) {
    await setSheet(sid, false);
    if (key) view().selected = key;
    setTab(key ? 'form' : state.tab);
  }

  // ------------------------------------------------------------------ schema (Fields tab)
  async function applySchema(payload) {
    if (hasEdits(state.sheetId)) {
      const ok = await S.confirmDialog({ title: 'Save your record changes first', confirmText: 'Save now', body: 'You have unsaved record edits on this sheet. They need to be saved before the fields can change, so nothing gets mixed up.' });
      if (!ok) return null;
      if (!(await saveAll())) return null;
    }
    try {
      const res = await api.put(`/api/workbooks/${state.id}/sheets/${state.sheetId}/schema`, { ...payload, baseRevision: state.wb.revision });
      const { summary } = applyResponse(res);
      state.views[state.sheetId] = { ...(state.views[state.sheetId] || {}), draft: null };
      state.fieldsDirty = false;
      const bits = [];
      if (summary.added) bits.push(`${summary.added} column${summary.added > 1 ? 's' : ''} added`);
      if (summary.removed) bits.push(`${summary.removed} removed`);
      if (summary.renamedHeaders) bits.push(`${summary.renamedHeaders} Excel header${summary.renamedHeaders > 1 ? 's' : ''} renamed`);
      // record in change log
      if (summary.added || summary.removed || summary.renamedHeaders) {
        state.changeLog.push({ at: Date.now(), sheetName: sheetName(state.sheetId), type: 'fields', ...summary });
      }
      toast('ok', 'Fields updated', (bits.join(', ') || 'Your field settings were saved') + '. The form, table, charts and download all use them now.');
      renderAll();
      return res;
    } catch (e) {
      if (e.code === 'VALIDATION') { toast('err', 'Some fields need fixing', 'Check the highlighted settings.'); return { fieldErrors: e.data.fieldErrors || {} }; }
      if (e.code === 'PLAN_LIMIT') upgradeNotice(e); else if (e.code === 'STALE') handleSaveError(e); else toast('err', 'Could not update fields', e.message);
      return null;
    }
  }

  // ------------------------------------------------------------------ undo / download / delete
  async function undo() {
    const last = state.undo[state.undo.length - 1];
    if (!last) return;
    if (hasEdits(last.sheetId)) {
      const ok = await S.confirmDialog({ title: 'Undo and discard unsaved edits?', confirmText: 'Undo', body: `Undoing “${last.label}” on “${sheetName(last.sheetId)}” will also discard its unsaved edits.` });
      if (!ok) return;
    }
    try {
      const res = await api.post(`/api/workbooks/${state.id}/undo`);
      applyResponse(res);
      clearEdits(res.sheet.id);
      state.views[res.sheet.id] = {};
      toast('ok', 'Undone', `“${res.undone}” on “${sheetName(res.sheet.id)}” was reverted.`);
      renderAll();
    } catch (e) { toast('err', 'Could not undo', e.message); }
  }

  async function downloadFile(url) {
    let res;
    try { res = await fetch(url, { credentials: 'same-origin', headers: { 'X-Requested-With': 'Sheet2App' } }); } catch { throw new Error('Cannot reach the server.'); }
    if (!res.ok) { let m = 'Download failed.'; try { m = (await res.json()).error || m; } catch { /* ignore */ } throw new Error(m); }
    const cd = res.headers.get('content-disposition') || '';
    const m = /filename\*=UTF-8''([^;]+)/i.exec(cd);
    const name = m ? decodeURIComponent(m[1]) : 'sheet2app-download';
    const blob = await res.blob();
    const a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return name;
  }

  // ------------------------------------------------------------------ download dialog helpers

  function buildChangeLogUI() {
    const log = state.changeLog;
    if (!log.length) return null;

    // Aggregate by sheet
    const bySheet = {};
    for (const entry of log) {
      const k = entry.sheetName;
      if (!bySheet[k]) bySheet[k] = { added: 0, updated: 0, deleted: 0, colAdded: 0, colRemoved: 0, colRenamed: 0 };
      if (entry.type === 'records') {
        bySheet[k].added   += entry.added   || 0;
        bySheet[k].updated += entry.updated || 0;
        bySheet[k].deleted += entry.deleted || 0;
      } else {
        bySheet[k].colAdded   += entry.added           || 0;
        bySheet[k].colRemoved += entry.removed         || 0;
        bySheet[k].colRenamed += entry.renamedHeaders  || 0;
      }
    }

    const rows = Object.entries(bySheet).map(([name, s]) => {
      const items = [];
      if (s.added)      items.push(h('span.dl-tag.dl-tag-add',  {}, `+${s.added} added`));
      if (s.updated)    items.push(h('span.dl-tag.dl-tag-upd',  {}, `${s.updated} edited`));
      if (s.deleted)    items.push(h('span.dl-tag.dl-tag-del',  {}, `−${s.deleted} deleted`));
      if (s.colAdded)   items.push(h('span.dl-tag.dl-tag-col',  {}, `+${s.colAdded} col`));
      if (s.colRemoved) items.push(h('span.dl-tag.dl-tag-col',  {}, `−${s.colRemoved} col`));
      if (s.colRenamed) items.push(h('span.dl-tag.dl-tag-col',  {}, `${s.colRenamed} renamed`));
      return h('div.dl-sheet-row', {},
        h('span.dl-sheet-name', {}, h('span', { html: icon('sheet') }), ' ' + name),
        h('span.dl-tags', {}, ...items));
    });

    // totals
    let totalRec = 0, totalFields = 0;
    for (const s of Object.values(bySheet)) {
      totalRec    += s.added + s.updated + s.deleted;
      totalFields += s.colAdded + s.colRemoved + s.colRenamed;
    }
    const summary = [];
    if (totalRec)    summary.push(`${totalRec} record change${totalRec === 1 ? '' : 's'}`);
    if (totalFields) summary.push(`${totalFields} field change${totalFields === 1 ? '' : 's'}`);

    return { el: h('div.dl-log', {}, ...rows), summary };
  }

  async function downloadExcel() {
    // --- Step 1: handle pending unsaved edits ---
    if (hasUnsaved()) {
      let skip = false;
      const extra = h('button.btn.btn-sm.btn-ghost', { type: 'button', style: 'margin-top:12px',
        onclick: (e) => { skip = true; e.target.closest('.modal').querySelector('.modal-actions .btn:not(.btn-primary)').click(); } },
        'Download the last saved version instead');
      const ok = await S.confirmDialog({ title: 'You have unsaved changes', confirmText: 'Save and download', cancelText: 'Cancel',
        body: 'The downloaded file only contains what has been saved. Save first so your latest edits are included.', extra });
      if (ok) { if (!(await saveAll())) return; } else if (!skip) return;
    }

    // --- Step 2: show change summary dialog ---
    const noChanges = !state.wb.saves;
    const logInfo = buildChangeLogUI();

    if (noChanges || !logInfo) {
      // No changes have been made since upload
      const proceed = await S.confirmDialog({
        title: 'No changes to include',
        confirmText: 'Download original anyway',
        cancelText: 'Cancel',
        body: h('div', {},
          h('div.dl-nochange', {},
            h('div', { html: icon('check') }),
            h('p', {}, 'You have not made any edits, added records, deleted rows or changed any field settings since this file was uploaded.')),
          h('p.small.muted', { style: 'margin-top:10px' }, 'If you still want the file, you can download the original workbook unchanged.')),
      });
      if (!proceed) return;
    } else {
      // Show what changed before downloading
      const savedTime = state.wb.savedAt ? new Date(state.wb.savedAt).toLocaleString() : null;
      const proceed = await S.confirmDialog({
        title: 'Ready to download',
        confirmText: 'Download updated Excel',
        cancelText: 'Cancel',
        body: h('div', {},
          h('p', {}, 'Your file includes ', h('b', {}, logInfo.summary.join(' and ')), ' since it was uploaded.'),
          savedTime ? h('p.small.muted', {}, `Last saved: ${savedTime}`) : null,
          logInfo.el),
      });
      if (!proceed) return;
    }

    // --- Step 3: trigger download ---
    const btn = $('#btn-download');
    if (btn) { btn.disabled = true; btn.lastChild && (btn.lastChild.textContent = ' Preparing…'); }
    try {
      const name = await downloadFile(`/api/workbooks/${state.id}/export.xlsx`);
      state.downloaded = true;
      toast('ok', 'Download started', `${name} is ready.`);
    } catch (e) { toast('err', 'Download failed', e.message + ' Your data is safe; please try again.'); }
    renderTopbar();
    if (state.tab === 'overview') renderView();
  }

  async function downloadCsv() {
    const s = cur();
    try { await downloadFile(`/api/workbooks/${state.id}/sheets/${s.id}/export.csv`); toast('ok', 'CSV download started', `Sheet “${s.name}” (last saved version).`); } catch (e) { toast('err', 'Download failed', e.message); }
  }

  async function deleteWorkbook() {
    const ok = await S.confirmDialog({ title: 'Delete this workbook?', danger: true, confirmText: 'Delete permanently', body: 'The uploaded file, your edits, saved charts and undo history will be removed from the server right now. Download your updated Excel first if you still need it.' });
    if (!ok) return;
    try { await api.del(`/api/workbooks/${state.id}`); S.forgetWorkbook(); state.edits = {}; state.fieldsDirty = false; toast('ok', 'Workbook deleted'); setTimeout(() => { location.href = '/'; }, 600); } catch (e) { toast('err', 'Could not delete', e.message); }
  }

  async function changeHeaderRow(sid, row) {
    if (!Number.isInteger(row) || row < 1) { toast('err', 'Enter a row number', 'For example 1 for the first row.'); return; }
    const ok = await S.confirmDialog({ title: `Use row ${row} as the column names?`, confirmText: 'Re-read sheet', body: `“${sheetName(sid)}” will be read again from your original file. Field settings and unsaved edits for this sheet will be reset.` });
    if (!ok) return;
    try {
      const res = await api.post(`/api/workbooks/${state.id}/sheets/${sid}/header-row`, { headerRow: row, baseRevision: state.wb.revision });
      applyResponse(res); clearEdits(sid); state.views[sid] = {};
      toast('ok', 'Sheet re-read', `Row ${row} is now used for the column names.`);
      renderAll();
    } catch (e) { toast(e.code === 'VALIDATION' ? 'err' : 'err', 'Could not use that row', e.message); }
  }

  // ------------------------------------------------------------------ navigation
  async function loadSheet(sid) {
    if (state.sheets[sid]) return state.sheets[sid];
    const r = await api.get(`/api/workbooks/${state.id}/sheets/${sid}`);
    state.sheets[sid] = r.sheet;
    return r.sheet;
  }

  async function setSheet(sid, render = true) {
    if (sid === state.sheetId) return;
    try { await loadSheet(sid); } catch (e) { toast('err', 'Could not open sheet', e.message); return; }
    state.sheetId = sid;
    if (render) renderAll(); else { renderSidebar(); renderMobileSelect(); }
  }

  function setTab(tab) {
    if (!TABS.some((t) => t[0] === tab)) tab = 'overview';
    if (state.tab === 'fields' && tab !== 'fields') { /* draft is kept in view state, so switching tabs never loses it */ }
    state.tab = tab; state.visited[tab] = true;
    try { history.replaceState(null, '', location.pathname + location.search + '#' + tab); } catch { /* ignore */ }
    renderTabs(); renderView();
  }

  // ------------------------------------------------------------------ ctx for views
  const ctx = {
    sheet: cur, viewState: view, effective, get: getValue, setValue, addRecord, deleteRecord, restoreRecord, discardRecord, confirmDelete, showEditPreview,
    errors: (key) => E(state.sheetId).errors[key] || {},
    openRecord: (key) => { view().selected = key; view().dismissed = false; setTab('form'); },
    save: () => saveAll(), revision: () => state.wb.revision, id: () => state.id, api, toast, upgradeNotice,
    setFieldsDirty: (b) => { if (state.fieldsDirty !== b) { state.fieldsDirty = b; updateSaveState(); } },
    applySchema, hasUnsaved, currentTab: () => state.tab,
    insightsOn: () => state.insights,
    setInsights: (on) => { state.insights = on; try { localStorage.setItem('s2a_insights', on ? '1' : '0'); } catch { /* ignore */ } },
    emptySheet: () => h('div.card', {}, h('div.empty', {}, h('div.em-ic', { html: icon('sheet') }), h('h3', {}, 'This sheet has no table to work with'),
      h('p', {}, ((cur().notes || [])[0] || {}).text || 'No column names or data were found.'), h('button.btn', { onclick: () => setTab('overview') }, 'Back to overview'))),
  };

  // ------------------------------------------------------------------ rendering
  function renderTopbar() {
    const host = $('#topbar');
    if (!state.wb) {
      host.replaceChildren(h('a.logo', { href: '/', html: S.LOGO + 'Sheet2App' }), h('div.top-actions', {}, h('button.btn.btn-sm', { 'data-act': 'demo' }, 'Try demo'), h('button.btn.btn-primary.btn-sm', { 'data-act': 'upload' }, h('span', { html: icon('upload') }), ' Upload Excel')));
      return;
    }
    const last = state.undo[state.undo.length - 1];
    const menu = h('div.menu', {},
      h('button.btn.btn-icon', { type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': String(state.menuOpen), 'aria-label': 'More actions', onclick: (e) => { e.stopPropagation(); state.menuOpen = !state.menuOpen; renderTopbar(); } }, h('span', { html: icon('menu') })),
      state.menuOpen ? h('div.menu-pop', { role: 'menu' },
        h('button', { role: 'menuitem', onclick: downloadCsv }, h('span', { html: icon('file') }), 'Export this sheet as CSV'),
        h('button', { role: 'menuitem', 'data-act': 'upload' }, h('span', { html: icon('upload') }), 'Upload another workbook'),
        h('a', { role: 'menuitem', href: '/privacy', target: '_blank', rel: 'noopener' }, h('span', { html: icon('shield') }), 'Privacy & limitations'),
        h('a', { role: 'menuitem', href: '/pricing', target: '_blank', rel: 'noopener' }, h('span', { html: icon('star') }), 'Plans & limits'),
        h('hr'),
        h('button.danger', { role: 'menuitem', onclick: deleteWorkbook }, h('span', { html: icon('trash') }), 'Delete workbook')) : null);
    host.replaceChildren(
      h('a.logo', { href: '/', 'aria-label': 'Sheet2App home', html: S.LOGO + '<span class="label">Sheet2App</span>' }),
      h('div.wb-title', {}, h('b', { title: state.wb.fileName }, state.wb.fileName), h('span', {}, `${state.wb.sheets.length} sheet${state.wb.sheets.length === 1 ? '' : 's'} · ${state.wb.plan} plan`)),
      h('span#save-state.save-state', { role: 'status' }),
      h('div.top-actions', {},
        h('button.btn.btn-sm', { type: 'button', disabled: !last || state.saving || null, title: last ? `Undo: ${last.label} on “${sheetName(last.sheetId)}”` : 'Nothing to undo yet', onclick: undo }, h('span', { html: icon('undo') }), h('span.label', {}, ' Undo')),
        h('button#btn-download.btn.btn-primary', { type: 'button', onclick: downloadExcel }, h('span', { html: icon('download') }), h('span', {}, ' Download Updated Excel')),
        menu));
    updateSaveState();
  }

  function renderSidebar() {
    const host = $('#sidebar');
    if (!state.wb) { host.replaceChildren(); return; }
    const lim = state.wb.limits;
    host.replaceChildren(
      h('div.side-h', {}, 'Worksheets'),
      ...state.wb.sheets.map((s) => h('button.sheet-btn', { type: 'button', 'aria-current': String(s.id === state.sheetId), onclick: () => setSheet(s.id) },
        h('span', { html: icon(s.empty ? 'file' : 'sheet') }), h('span.nm', { title: s.name }, s.name),
        hasEdits(s.id) ? h('span.dot', { title: 'Unsaved changes', role: 'img', 'aria-label': 'Unsaved changes' }) : null,
        h('span.ct', {}, s.empty ? '–' : String(s.records)))),
      h('div.side-card', {}, h('b', {}, `${state.wb.plan[0].toUpperCase()}${state.wb.plan.slice(1)} plan`),
        h('div.xs.muted', { style: 'margin-top:4px' }, `Up to ${lim.maxRowsPerSheet.toLocaleString('en-IN')} records per sheet, ${lim.maxSheets} sheets, ${lim.maxUploadMB} MB files.`),
        h('a.xs', { href: '/pricing', target: '_blank', rel: 'noopener' }, 'Compare plans')),
      h('div.side-card', {}, h('b', {}, 'Private & temporary'), h('div.xs.muted', { style: 'margin-top:4px' }, `Only this browser can open this workbook. It is deleted automatically after ${(S.config && S.config.workspaceTtlHours) || 24} hours of inactivity.`), h('a.xs', { href: '/privacy', target: '_blank', rel: 'noopener' }, 'How we handle data')));
  }

  function renderMobileSelect() {
    const host = $('#sheet-select-mobile');
    if (!state.wb) { host.replaceChildren(); return; }
    host.replaceChildren(h('label.lbl', { for: 'm-sheet' }, 'Worksheet'), h('select.select', { id: 'm-sheet', onchange: (e) => setSheet(e.target.value) }, state.wb.sheets.map((s) => h('option', { value: s.id, selected: s.id === state.sheetId || null }, `${s.name}${hasEdits(s.id) ? ' •' : ''}`))));
  }

  function renderTabs() {
    const host = $('#tabs');
    if (!state.wb) { host.replaceChildren(); host.style.display = 'none'; return; }
    host.style.display = '';
    const n = state.sheetId ? Object.keys((state.edits[state.sheetId] || { map: {} }).map).length : 0;
    host.replaceChildren(...TABS.map(([id, label, ic]) => h('button.tab', {
      type: 'button', role: 'tab', id: 'tab-' + id, 'aria-selected': String(state.tab === id), tabindex: state.tab === id ? '0' : '-1', onclick: () => setTab(id),
      onkeydown: (e) => { const i = TABS.findIndex((t) => t[0] === id); const j = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null; if (j !== null) { e.preventDefault(); setTab(TABS[(j + TABS.length) % TABS.length][0]); $('#tab-' + state.tab).focus(); } },
    }, h('span', { html: icon(ic) }), label, id === 'data' && n ? h('span.badge.warn', {}, String(n)) : null)));
  }

  function renderView() {
    const root = $('#view');
    if (S.insights) S.insights.disposeAll();
    if (!state.wb) return;
    const s = cur();
    if (state.tab === 'overview') overviewView(root);
    else if (!s) root.replaceChildren(h('div.skeleton', { style: 'height:200px' }));
    else if (state.tab === 'data') S.tables.dataView(ctx, root);
    else if (state.tab === 'form') S.fields.formView(ctx, root);
    else if (state.tab === 'fields') S.editor.editorView(ctx, root);
    else if (state.tab === 'insights') S.insights.insightsView(ctx, root);
  }

  function renderAll() { renderTopbar(); renderSidebar(); renderMobileSelect(); renderTabs(); renderView(); renderDirty(); updateSaveState(); }

  // ------------------------------------------------------------------ overview
  function overviewView(root) {
    const wb = state.wb;
    const recs = wb.sheets.reduce((a, s) => a + s.records, 0);
    const cols = wb.sheets.reduce((a, s) => a + s.columns, 0);
    const scored = wb.sheets.filter((s) => s.quality && s.quality.score !== null);
    const avgQ = scored.length ? Math.round(scored.reduce((a, s) => a + s.quality.score, 0) / scored.length) : null;
    const steps = [
      ['Review the fields we detected', 'Check each field type, label and help text.', () => setTab('fields'), Boolean(state.visited.fields)],
      ['Edit or add a record', 'Use the table or the one-record form, then Save.', () => setTab('data'), wb.saves > 0],
      ['Turn on Insights', 'See charts and plain-language explanations.', () => setTab('insights'), state.insights],
      ['Download your updated Excel', 'Your edits go back into your original file.', downloadExcel, state.downloaded],
    ];
    root.replaceChildren(
      h('div.view-head', {}, h('div', {}, h('h2', {}, 'Workbook overview'), h('p', {}, `“${wb.fileName}” was read successfully. Here is what we found in each sheet.`))),
      h('div.card.next-steps', {}, h('b', {}, 'Your next steps'), h('ol', {}, steps.map(([t, d, fn, done], i) => h('li' + (done ? '.done' : ''), {}, h('span.n', {}, done ? '✓' : String(i + 1)), h('div', {}, h('button.btn-link', { type: 'button', style: 'all:unset;cursor:pointer;font-weight:700;color:var(--brand-700);text-decoration:underline', onclick: fn }, t), h('div.xs.muted', {}, d)))))),
      h('div.kpi-grid', {},
        h('div.card.kpi', {}, h('div.kl', {}, 'Worksheets'), h('div.kv', {}, String(wb.sheets.length)), h('div.kh', {}, 'Each has its own form, table and charts')),
        h('div.card.kpi', {}, h('div.kl', {}, 'Total records'), h('div.kv', {}, recs.toLocaleString('en-IN')), h('div.kh', {}, 'Rows across all sheets')),
        h('div.card.kpi', {}, h('div.kl', {}, 'Total fields'), h('div.kv', {}, cols.toLocaleString('en-IN')), h('div.kh', {}, 'Columns turned into form fields')),
        avgQ !== null ? h('div.card.kpi', {}, h('div.kl', {}, 'Average data quality'), h('div.kv', {}, avgQ + '/100'), h('div.kh', {}, 'Based on blank cells and duplicate rows')) : null),
      h('div.sheet-cards', {}, wb.sheets.map((s) => sheetCard(s))),
      h('div.notice', { style: 'margin-top:20px' }, h('span', { html: icon('lock') }), h('span', {}, 'Your workbook is private to this browser and is deleted automatically. ', h('a', { href: '/privacy', target: '_blank', rel: 'noopener' }, 'Read how data is handled'), '.')));
  }

  function sheetCard(s) {
    const q = s.quality || {};
    const color = q.score === null || q.score === undefined ? '#c4cadb' : q.score >= 75 ? 'var(--ok)' : q.score >= 50 ? 'var(--warn)' : 'var(--danger)';
    const notes = s.notes || [];
    const shown = notes.slice(0, 3);
    const hdrInput = h('input.input', { type: 'number', min: 1, 'aria-label': `Header row for ${s.name}`, placeholder: 'Row', style: 'width:84px' });
    const loaded = state.sheets[s.id];
    if (loaded && loaded.headerRow) hdrInput.value = loaded.headerRow;
    return h('div.card.sheet-card', {},
      h('h3', {}, h('span', {}, s.name), s.empty ? h('span.badge.gray', {}, 'Empty') : s.hidden ? h('span.badge.gray', {}, 'Hidden in Excel') : s.warnings ? h('span.badge.warn', {}, `${s.warnings} to review`) : h('span.badge.ok', {}, 'Looks good')),
      s.empty ? h('p.small.muted', {}, 'No table found on this sheet.') : h('dl', {}, h('div', {}, h('dt', {}, 'Records'), h('dd', {}, s.records.toLocaleString('en-IN'))), h('div', {}, h('dt', {}, 'Fields'), h('dd', {}, String(s.columns)))),
      !s.empty && q.score !== null ? h('div', { style: 'margin-bottom:10px' }, h('div.xs.muted', { style: 'display:flex;justify-content:space-between' }, h('span', {}, 'Data quality'), h('b', {}, `${q.score}/100 · ${q.label}`)), h('div.quality-bar', { role: 'img', 'aria-label': `Data quality ${q.score} out of 100` }, h('i', { style: `width:${q.score}%;background:${color}` }))) : null,
      shown.length ? h('div.note-list', {}, shown.map((n) => h('div.notice' + (n.level === 'warn' ? '.warn' : ''), { style: 'padding:9px 12px;font-size:.84rem' }, h('span', { html: icon(n.level === 'warn' ? 'alert' : 'info') }), h('span', {}, n.text)))) : null,
      notes.length > shown.length ? h('p.xs.muted', { style: 'margin:8px 0 0' }, `+ ${notes.length - shown.length} more note(s). Open the sheet to see all.`) : null,
      h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:14px' },
        !s.empty ? h('button.btn.btn-primary.btn-sm', { type: 'button', onclick: async () => { await setSheet(s.id, false); setTab('data'); renderAll(); } }, h('span', { html: icon('sheet') }), ' Open data') : null,
        !s.empty ? h('button.btn.btn-sm', { type: 'button', onclick: async () => { await setSheet(s.id, false); setTab('fields'); renderAll(); } }, h('span', { html: icon('cog') }), ' Fields') : null),
      h('details', { style: 'margin-top:12px' + (s.headerUncertain ? '' : ''), open: s.headerUncertain || null },
        h('summary.small', { style: 'cursor:pointer;font-weight:650;color:var(--ink-2)' }, s.headerUncertain ? 'Check the header row' : 'Column names in the wrong row?'),
        h('div', { style: 'display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap' },
          h('span.small.muted', {}, 'Header row number:'), hdrInput,
          h('button.btn.btn-sm', { type: 'button', onclick: async () => { await loadSheet(s.id).catch(() => {}); changeHeaderRow(s.id, parseInt(hdrInput.value, 10)); } }, 'Use this row'))));
  }

  // ------------------------------------------------------------------ welcome (no workbook)
  async function renderWelcome(message) {
    state.wb = null;
    renderTopbar(); renderSidebar(); renderTabs(); renderMobileSelect();
    $('.shell').style.gridTemplateColumns = '1fr';
    $('#sidebar').style.display = 'none';
    const root = $('#view');
    let list = [];
    try { list = (await api.get('/api/workbooks')).workbooks; } catch { /* ignore */ }

    // tracked checkbox selection
    const sel = new Set();

    function buildWelcome() {
      const allChecked = list.length > 0 && list.every((w) => sel.has(w.id));
      const nSel = sel.size;

      const deleteSelected = async () => {
        if (!nSel) return;
        const noun = nSel === 1 ? '1 workbook' : `${nSel} workbooks`;
        const ok = await S.confirmDialog({
          title: `Delete ${noun}?`, danger: true, confirmText: `Delete ${noun}`,
          body: `The uploaded file, edits, charts and undo history for the selected workbook${nSel === 1 ? '' : 's'} will be removed from the server. This cannot be undone.`,
        });
        if (!ok) return;
        const ids = [...sel];
        for (const id of ids) {
          try { await api.del(`/api/workbooks/${id}`); if (S.lastWorkbook() === id) S.forgetWorkbook(); list = list.filter((w) => w.id !== id); sel.delete(id); } catch { /* skip */ }
        }
        buildWelcome();
      };

      const workbookRows = list.map((w) => {
        const checked = sel.has(w.id);
        const uploaded = w.createdAt ? new Date(w.createdAt).toLocaleString() : '—';
        const updated  = w.savedAt   ? new Date(w.savedAt).toLocaleString()   : '—';
        const expires  = w.expiresAt ? new Date(w.expiresAt).toLocaleString() : '—';
        const row = h('div.wb-list-row' + (checked ? '.selected' : ''), {},
          h('label.wb-list-check', { title: 'Select to delete' },
            h('input', { type: 'checkbox', checked: checked || null, onchange: (e) => { e.target.checked ? sel.add(w.id) : sel.delete(w.id); buildWelcome(); } })),
          h('div.wb-list-info', {},
            h('b', {}, w.fileName),
            h('div.xs.muted', {},
              h('span', {}, `${w.sheets} sheet${w.sheets === 1 ? '' : 's'}`),
              h('span.wb-list-sep', {}, '·'),
              h('span', {}, `Uploaded ${uploaded}`),
              w.savedAt ? [h('span.wb-list-sep', {}, '·'), h('span', {}, `Last saved ${updated}`)] : null,
              h('span.wb-list-sep', {}, '·'),
              h('span', { style: 'color:var(--warn)' }, `Expires ${expires}`))),
          h('div.wb-list-actions', {},
            h('button.btn.btn-sm.btn-primary', { type: 'button', onclick: () => S.openWorkbook(w.id) }, h('span', { html: icon('sheet') }), ' Open')));
        return row;
      });

      root.replaceChildren(h('div', { style: 'max-width:820px;margin:40px auto' },
        message ? h('div.notice.warn', { style: 'margin-bottom:18px' }, h('span', { html: icon('alert') }), h('span', {}, message)) : null,
        h('div.card', {}, h('div.empty', {},
          h('div.em-ic', { html: icon('upload') }),
          h('h3', {}, 'Start with an Excel file'),
          h('p', {}, 'Upload a workbook (.xlsx) and your app is ready in seconds, or explore with fictional sample data first.'),
          h('div', { style: 'display:flex;gap:10px;justify-content:center;flex-wrap:wrap' },
            h('button.btn.btn-primary.btn-lg', { 'data-act': 'upload' }, h('span', { html: icon('upload') }), ' Upload your Excel'),
            h('button.btn.btn-lg', { 'data-act': 'demo' }, 'Try the demo')))),
        list.length ? h('div.card', { style: 'margin-top:18px;padding:0;overflow:hidden' },
          h('div.wb-list-header', {},
            h('div.wb-list-header-left', {},
              h('label.wb-list-check', { title: 'Select all' },
                h('input', { type: 'checkbox', checked: allChecked || null, onchange: (e) => { list.forEach((w) => e.target.checked ? sel.add(w.id) : sel.delete(w.id)); buildWelcome(); } })),
              h('b', {}, `Your workbooks  (${list.length})`)),
            nSel > 0
              ? h('button.btn.btn-sm.btn-danger', { type: 'button', onclick: deleteSelected },
                  h('span', { html: icon('trash') }), ` Delete selected (${nSel})`)
              : h('span.xs.muted', {}, 'Tick a box to select for deletion')),
          h('div.wb-list-body', {}, ...workbookRows)) : null));
    }

    buildWelcome();
  }

  // ------------------------------------------------------------------ boot
  async function init() {
    S.wireGlobalActions(null, null);
    document.addEventListener('click', () => { if (state.menuOpen) { state.menuOpen = false; renderTopbar(); } });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.menuOpen) { state.menuOpen = false; renderTopbar(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && state.wb) { e.preventDefault(); if (hasUnsaved()) saveAll(); }
    });
    window.addEventListener('beforeunload', (e) => { if (hasUnsaved() || state.fieldsDirty) { e.preventDefault(); e.returnValue = ''; } });

    api.get('/api/config').then((c) => { S.config = c; if (state.wb) renderSidebar(); }).catch(() => {});

    const params = new URLSearchParams(location.search);
    const id = params.get('wb') || S.lastWorkbook();
    if (!id || !/^[a-f0-9]{32}$/.test(id)) { await renderWelcome(); return; }
    try {
      const ov = await api.get(`/api/workbooks/${id}`);
      state.id = id;
      state.undo = ov.undo || [];
      delete ov.undo;
      state.wb = ov;
      S.rememberWorkbook(id);
      const first = ov.sheets.find((s) => !s.empty) || ov.sheets[0];
      state.sheetId = first.id;
      state.sheets[first.id] = (await api.get(`/api/workbooks/${id}/sheets/${first.id}`)).sheet;
      const hash = location.hash.replace('#', '');
      state.tab = TABS.some((t) => t[0] === hash) ? hash : 'overview';
      state.visited[state.tab] = true;
      document.title = `${ov.fileName} — Sheet2App`;
      renderAll();
    } catch (e) {
      S.forgetWorkbook();
      await renderWelcome(e.code === 'EXPIRED' ? 'That workbook expired and was deleted automatically. Upload your file again to continue.' : e.status === 404 ? 'We could not find that workbook. It may have expired, or it belongs to a different browser.' : e.message);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
