/* Field editor: customise how each spreadsheet column appears in the generated app. */
(function () {
  'use strict';
  const { h, $, $$, icon } = window.S2A;
  const F = () => window.S2A.fields;
  const TYPES = ['text', 'textarea', 'integer', 'decimal', 'currency', 'date', 'datetime', 'boolean', 'dropdown', 'searchable', 'email', 'url', 'phone', 'readonly'];
  const OPTION_TYPES = new Set(['dropdown', 'searchable']);
  const NUM = new Set(['integer', 'decimal', 'currency']);
  const TEXTY = new Set(['text', 'textarea', 'email', 'url', 'phone']);

  /**
   * Draft = working copy of the columns. Nothing is sent to the server until "Apply changes".
   * Each draft column keeps `_orig` (the saved copy) so we can show what changed.
   */
  function makeDraft(sheet) {
    return sheet.columns.map((c) => ({ ...JSON.parse(JSON.stringify(c)), _orig: JSON.stringify(c), _removed: false }));
  }

  const PERSIST = ['id', 'label', 'header', 'type', 'helpText', 'placeholder', 'required', 'options', 'defaultValue', 'readOnly', 'visible', 'inTable', 'chartable', 'validation'];
  function toPayload(d) {
    const o = {};
    for (const k of PERSIST) if (k in d && !(k === 'id' && d._new)) o[k] = d[k];
    if (d._new) { delete o.id; }
    return o;
  }
  function isChanged(d) { if (d._new) return true; const { _orig, _removed, _new, _open, ...rest } = d; return JSON.stringify(rest) !== d._orig; }

  function editorView(ctx, root) {
    const sheet = ctx.sheet();
    root.replaceChildren();
    if (sheet.empty) { root.append(ctx.emptySheet()); return; }
    const view = ctx.viewState();
    if (!view.draft || view.draftRev !== ctx.revision() || view.draftSheet !== sheet.id) { view.draft = makeDraft(sheet); view.draftRev = ctx.revision(); view.draftSheet = sheet.id; view.errors = {}; }
    const draft = view.draft;
    let previewId = view.previewId && draft.find((d) => d.id === view.previewId) ? view.previewId : (draft.find((d) => !d._removed) || {}).id;
    let dragIdx = null;

    const listHost = h('div.fe-list');
    const previewHost = h('div.card.fe-preview');
    const barHost = h('div');

    const live = () => draft.filter((d) => !d._removed);
    const dirty = () => draft.some((d) => d._removed || isChanged(d)) || order().join() !== sheet.columns.map((c) => c.id).join();
    const order = () => live().map((d) => d.id);

    function updateBar() {
      const n = draft.filter((d) => d._removed || isChanged(d)).length + (order().join() !== sheet.columns.filter((c) => !draft.find((d) => d.id === c.id && d._removed)).map((c) => c.id).join() ? 1 : 0);
      const dirt = dirty();
      barHost.replaceChildren(h('div.card.card-pad', { style: 'display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:14px;position:sticky;top:72px;z-index:5' },
        h('div', { style: 'flex:1;min-width:200px' }, dirt ? h('b', {}, 'You have unapplied changes to the fields') : h('b', {}, 'Fields'), h('div.small.muted', {}, dirt ? 'Nothing changes in your data until you click Apply.' : 'Click a field to edit it. Drag the handle to reorder.')),
        h('button.btn', { type: 'button', onclick: addColumn }, h('span', { html: icon('plus') }), ' Add column'),
        h('button.btn', { type: 'button', disabled: !dirt || null, onclick: () => { view.draft = null; editorView(ctx, root); } }, 'Reset'),
        h('button.btn.btn-primary', { type: 'button', disabled: !dirt || null, onclick: apply }, h('span', { html: icon('check') }), ' Apply changes')));
      ctx.setFieldsDirty(dirt);
    }

    function addColumn() {
      const nid = 'new' + Date.now().toString(36);
      draft.push({ id: nid, _new: true, _open: true, _orig: '', _removed: false, label: '', header: '', type: 'text', helpText: '', placeholder: '', required: false, options: [], defaultValue: null, readOnly: false, visible: true, inTable: true, chartable: true, validation: {}, helpSuggested: true, boolTrue: true, boolFalse: false, inferReason: 'New column you added.', confidence: 'high', originalHeader: null });
      previewId = nid; view.previewId = nid;
      paintList(); paintPreview(); updateBar();
      setTimeout(() => { const el = document.getElementById('fe-label-' + nid); if (el) { el.scrollIntoView({ block: 'center' }); el.focus(); } }, 30);
    }

    async function apply() {
      const removed = draft.filter((d) => d._removed && !d._new);
      if (removed.length) {
        const ok = await window.S2A.confirmDialog({
          title: `Delete ${removed.length} column${removed.length > 1 ? 's' : ''}?`,
          danger: true, confirmText: `Delete and apply`,
          body: h('div', {}, h('p', {}, 'The data in these columns will be removed from the downloaded Excel file:'), h('ul', {}, removed.map((d) => h('li', {}, h('b', {}, d.label)))), h('p.small.muted', {}, 'You can use Undo right after applying if you change your mind.')),
        });
        if (!ok) return;
      }
      const errs = {};
      live().forEach((d) => { if (!String(d.label || '').trim()) errs[d.id] = { label: 'Give this field a name.' }; });
      if (Object.keys(errs).length) { view.errors = errs; paintList(); ctx.toast('err', 'Some fields need a name', 'Fill in the highlighted names, then apply again.'); return; }
      const payload = { columns: live().map((d) => (d._new ? toPayload(d) : { ...toPayload(d) })), confirmDelete: removed.map((d) => d.id) };
      // new columns need an id of 'new...' so the server recognises them; fall back header = label
      payload.columns.forEach((c, i) => { const d = live()[i]; if (d._new) { c.id = d.id; if (!c.header) c.header = c.label; } });
      const res = await ctx.applySchema(payload);
      if (res && res.fieldErrors) { view.errors = res.fieldErrors; paintList(); }
    }

    function setField(d, key, val, rerender) {
      d[key] = val;
      if (key === 'type') {
        if (OPTION_TYPES.has(val) && !d.options.length) {
          const seen = new Set();
          for (const r of sheet.rows) { const v = r.v[d.id]; if (!F().isEmpty(v)) seen.add(String(v)); if (seen.size > 100) break; }
          d.options = [...seen].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        }
        if (val === 'readonly') d.readOnly = true; else if (d.readOnly && d._orig && JSON.parse(d._orig).type === 'readonly') d.readOnly = false;
      }
      if (key === 'label' && d._new && !d._headerTouched) d.header = val;
      if (key === 'header') d._headerTouched = true;
      previewId = d.id; view.previewId = d.id;
      if (rerender) paintList(); else refreshHead(d);
      paintPreview(); updateBar();
    }

    function refreshHead(d) {
      const item = listHost.querySelector(`[data-id="${CSS.escape(d.id)}"]`);
      if (!item) return;
      const t = item.querySelector('.fe-title b'); if (t) t.textContent = d.label || 'Untitled field';
      const s = item.querySelector('.fe-title span'); if (s) s.textContent = subtitle(d);
    }

    const subtitle = (d) => `${F().TYPE_LABEL[d.type]}${d.header && d.label !== d.header ? ' · Excel header: ' + d.header : ''}${d.required ? ' · required' : ''}`;
    const err = (d, k) => view.errors && view.errors[d.id] && view.errors[d.id][k];

    function lbl(text, id, hint) { return h('label.lbl', { for: id }, text, hint ? h('span.xs.muted', { style: 'font-weight:400' }, ' ' + hint) : null); }
    function errLine(d, k) { const e = err(d, k); return e ? h('div.err-msg', { role: 'alert' }, e) : null; }

    function body(d) {
      const p = `fe-${d.id}`;
      const optionsText = h('textarea.textarea', { id: p + '-opts', rows: 4, 'aria-describedby': p + '-opts-h', oninput: (e) => setField(d, 'options', e.target.value.split('\n').map((s) => s.trim()).filter(Boolean)) });
      optionsText.value = d.options.join('\n');
      const num = (k) => h('input.input', { id: `${p}-${k}`, type: 'number', step: 'any', value: d.validation && d.validation[k] !== undefined ? d.validation[k] : '', oninput: (e) => { const v = { ...(d.validation || {}) }; if (e.target.value === '') delete v[k]; else v[k] = Number(e.target.value); setField(d, 'validation', v); } });
      const toggle = (k, text) => h('label.mini-check', {}, h('input', { type: 'checkbox', checked: d[k] || null, disabled: (k === 'required' && (d.readOnly || d.type === 'readonly')) || null, onchange: (e) => setField(d, k, e.target.checked, k === 'visible' || k === 'readOnly' || k === 'required') }), ' ' + text);
      const hdrDiff = d.header && d.label && d.header !== d.label;
      return h('div.fe-body', {},
        h('div.fe-grid', {},
          h('div', {}, lbl('Display label', `fe-label-${d.id}`, '(what people see)'), h('input.input' + (err(d, 'label') ? '.invalid' : ''), { id: `fe-label-${d.id}`, value: d.label, maxlength: 120, placeholder: 'e.g. Joining date', oninput: (e) => setField(d, 'label', e.target.value, false) }), errLine(d, 'label')),
          h('div', {}, lbl('Excel header', `${p}-hdr`, '(the real column name in the file)'), h('input.input' + (err(d, 'header') ? '.invalid' : ''), { id: `${p}-hdr`, value: d.header, maxlength: 255, oninput: (e) => setField(d, 'header', e.target.value, false) }), errLine(d, 'header'),
            h('div.xs.muted', { style: 'margin-top:4px' }, hdrDiff ? 'The downloaded file uses this header. The label above is only shown in the app.' : d._new ? 'Used as the column title in the downloaded Excel file.' : 'Changing this renames the column in the downloaded file.')),
          h('div', {}, lbl('Field type', `${p}-type`), h('select.select', { id: `${p}-type`, onchange: (e) => setField(d, 'type', e.target.value, true) }, TYPES.map((t) => h('option', { value: t, selected: d.type === t || null }, F().TYPE_LABEL[t]))), errLine(d, 'type'),
            d.inferReason && !d._new ? h('div.why', {}, h('b', {}, d.confidence === 'low' ? 'Why this guess (low confidence): ' : 'Why this type: '), d.inferReason) : null),
          h('div', {}, lbl('Placeholder', `${p}-ph`, '(faint example text)'), h('input.input', { id: `${p}-ph`, value: d.placeholder || '', maxlength: 100, oninput: (e) => setField(d, 'placeholder', e.target.value, false) })),
          h('div.span-2', {}, lbl('Help text', `${p}-help`, d.helpSuggested && d.helpText ? '(suggested for you – edit or clear it)' : ''), h('input.input', { id: `${p}-help`, value: d.helpText || '', maxlength: 300, placeholder: 'A short explanation shown under the field', oninput: (e) => { d.helpSuggested = false; setField(d, 'helpText', e.target.value, false); } }), errLine(d, 'helpText')),
          OPTION_TYPES.has(d.type) ? h('div.span-2', {}, lbl('Dropdown options', p + '-opts', '(one per line)'), optionsText, h('div.xs.muted', { id: p + '-opts-h' }, 'People can only choose from this list. Existing values that are not in the list stay as they are until edited.'), errLine(d, 'options')) : null,
          NUM.has(d.type) ? [h('div', {}, lbl('Smallest allowed value', `${p}-min`), num('min'), errLine(d, 'min')), h('div', {}, lbl('Largest allowed value', `${p}-max`), num('max'), errLine(d, 'max'))] : null,
          TEXTY.has(d.type) ? [h('div', {}, lbl('Minimum length', `${p}-minLength`), num('minLength')), h('div', {}, lbl('Maximum length', `${p}-maxLength`), num('maxLength'), errLine(d, 'maxLength'))] : null,
          d.type !== 'readonly' && d.type !== 'boolean' ? h('div', {}, lbl('Default for new records', `${p}-def`), h('input.input', { id: `${p}-def`, value: d.defaultValue ?? '', oninput: (e) => setField(d, 'defaultValue', e.target.value === '' ? null : e.target.value, false) }), errLine(d, 'defaultValue'), d._new ? h('div.xs.muted', { style: 'margin-top:4px' }, 'Also filled into every existing record. Leave empty for blank.') : null) : null),
        h('div.fe-toggles', { style: 'margin-top:16px' }, toggle('required', 'Required'), toggle('readOnly', 'Read-only'), toggle('visible', 'Show in form'), toggle('inTable', 'Show in table'), toggle('chartable', 'Use in charts')));
    }

    function paintList() {
      listHost.replaceChildren(...draft.map((d, i) => {
        const open = d._open;
        const changed = isChanged(d);
        const item = h('div.card.fe-item' + (d.visible === false ? '.hidden-field' : '') + (d._removed ? '.removed' : ''), { 'data-id': d.id, draggable: 'false' },
          h('div.fe-head', {},
            h('span.fe-grip', { title: 'Drag to reorder', 'aria-hidden': 'true', html: icon('grip'), onmousedown: () => item.setAttribute('draggable', 'true') }),
            h('button.fe-title', { type: 'button', 'aria-expanded': String(Boolean(open)), onclick: () => { d._open = !d._open; previewId = d.id; view.previewId = d.id; paintList(); paintPreview(); } },
              h('b', {}, d._removed ? `${d.label} (will be deleted)` : (d.label || 'Untitled field')), h('span', {}, subtitle(d))),
            changed && !d._removed ? h('span.badge.warn', {}, d._new ? 'New' : 'Edited') : null,
            h('span', {}, h('span.badge.gray', {}, F().TYPE_ICON[d.type] + ' ' + F().TYPE_LABEL[d.type])),
            h('div', { style: 'display:flex;gap:2px' },
              h('button.btn.btn-ghost.btn-sm.btn-icon', { type: 'button', 'aria-label': 'Move ' + d.label + ' up', disabled: i === 0 || null, onclick: () => move(i, -1) }, h('span', { html: icon('up') })),
              h('button.btn.btn-ghost.btn-sm.btn-icon', { type: 'button', 'aria-label': 'Move ' + d.label + ' down', disabled: i === draft.length - 1 || null, onclick: () => move(i, 1) }, h('span', { html: icon('down') })),
              h('button.btn.btn-ghost.btn-sm.btn-icon', { type: 'button', 'aria-label': (d.visible === false ? 'Show ' : 'Hide ') + d.label, title: d.visible === false ? 'Hidden from the form. Click to show.' : 'Visible. Click to hide.', onclick: () => setField(d, 'visible', d.visible === false, true) }, h('span', { html: icon(d.visible === false ? 'eyeoff' : 'eye') })),
              d._removed
                ? h('button.btn.btn-sm', { type: 'button', onclick: () => { d._removed = false; paintList(); updateBar(); paintPreview(); } }, 'Keep')
                : h('button.btn.btn-ghost.btn-sm.btn-icon', { type: 'button', 'aria-label': 'Remove ' + d.label, title: 'Remove this column', onclick: () => removeColumn(d, i) }, h('span', { html: icon('trash'), style: 'color:var(--danger)' })))),
          open && !d._removed ? body(d) : null);
        item.addEventListener('dragstart', (e) => { dragIdx = i; item.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', d.id); });
        item.addEventListener('dragend', () => { item.classList.remove('dragging'); item.setAttribute('draggable', 'false'); $$('.drop-target', listHost).forEach((x) => x.classList.remove('drop-target')); });
        item.addEventListener('dragover', (e) => { if (dragIdx === null) return; e.preventDefault(); item.classList.add('drop-target'); });
        item.addEventListener('dragleave', () => item.classList.remove('drop-target'));
        item.addEventListener('drop', (e) => { e.preventDefault(); if (dragIdx === null || dragIdx === i) return; const [m] = draft.splice(dragIdx, 1); draft.splice(i, 0, m); dragIdx = null; paintList(); updateBar(); });
        return item;
      }));
    }

    function move(i, d) { const j = i + d; if (j < 0 || j >= draft.length) return; [draft[i], draft[j]] = [draft[j], draft[i]]; paintList(); updateBar(); const b = listHost.querySelectorAll('.fe-item')[j]; if (b) b.querySelector(`button[aria-label^="Move"]`) && b.scrollIntoView({ block: 'nearest' }); }

    function removeColumn(d, i) {
      if (d._new) { draft.splice(i, 1); paintList(); paintPreview(); updateBar(); return; }
      if (live().length <= 1) { ctx.toast('err', 'Keep at least one column', 'A sheet needs at least one column.'); return; }
      d._removed = true; d._open = false; paintList(); paintPreview(); updateBar();
    }

    function paintPreview() {
      const d = draft.find((x) => x.id === previewId && !x._removed) || live()[0];
      previewHost.replaceChildren(h('h4', {}, 'Live preview'), h('p.small.muted', {}, 'This is how the field will look in the form.'));
      if (!d) { previewHost.append(h('p.muted', {}, 'No field selected.')); return; }
      const sample = sheet.rows.map((r) => r.v[d.id]).find((v) => !F().isEmpty(v));
      const col = { ...d, label: d.label || 'Untitled field', options: d.options || [] };
      const fld = F().field(col, d.defaultValue ?? sample ?? null, { id: 'prev-' + d.id, disabled: false });
      previewHost.append(h('div.fields', { style: 'grid-template-columns:1fr' }, fld.el));
      if (d.required && !(d.readOnly || d.type === 'readonly')) previewHost.append(h('p.xs.muted', {}, 'People must fill this in before saving.'));
      if (d.type === 'boolean' && !d._new) previewHost.append(h('p.xs.muted', {}, `Saved to Excel as "${d.boolTrue}" / "${d.boolFalse}" – the same words your file already uses.`));
      if (!d.visible) previewHost.append(h('p.notice.warn.small', { style: 'margin-top:12px' }, 'This field is hidden, so it will not appear in the form.'));
    }

    root.append(h('div', {}, barHost, h('div.fe-layout', {}, listHost, previewHost)));
    paintList(); paintPreview(); updateBar();
  }

  window.S2A.editor = { editorView };
})();
