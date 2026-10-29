/* Field controls, value formatting, client-side validation (mirrors the server; the server is authoritative)
   and the one-record Form view. */
(function () {
  'use strict';
  const { h, $, $$, icon, esc } = window.S2A;

  const NUM = new Set(['integer', 'decimal', 'currency']);
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const TYPE_LABEL = {
    text: 'Text box', textarea: 'Text area', integer: 'Whole number', decimal: 'Decimal number', currency: 'Money', date: 'Date picker',
    datetime: 'Date & time', boolean: 'Checkbox', dropdown: 'Dropdown list', searchable: 'Searchable list', email: 'Email', url: 'Web link', phone: 'Phone', readonly: 'Read-only',
  };
  const TYPE_ICON = { text: 'T', textarea: '¶', integer: '#', decimal: '1.5', currency: '₹', date: '📅', datetime: '🕒', boolean: '☑', dropdown: '▾', searchable: '⌕', email: '@', url: '🔗', phone: '☎', readonly: '🔒' };
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  const cfg = () => window.S2A.config || { currency: '₹' };
  const isEmpty = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
  const lc = (v) => String(v).toLowerCase();

  function fmtDate(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(s || '');
    if (!m) return String(s ?? '');
    return `${+m[3]} ${MON[+m[2] - 1]} ${m[1]}` + (m[4] ? `, ${m[4]}:${m[5]}` : '');
  }

  function fmtNum(n, col) {
    const x = typeof n === 'number' ? n : Number(n);
    if (!Number.isFinite(x)) return String(n);
    const prefix = col && col.type === 'currency' ? cfg().currency : '';
    return prefix + x.toLocaleString('en-IN', { maximumFractionDigits: col && col.type === 'integer' ? 0 : 6 });
  }

  /** Real checkbox state for a stored value: true | false | null (unknown/blank). */
  function boolOf(col, v) {
    if (isEmpty(v)) return null;
    if (v === col.boolTrue || (typeof v === 'string' && typeof col.boolTrue === 'string' && lc(v) === lc(col.boolTrue))) return true;
    if (v === col.boolFalse || (typeof v === 'string' && typeof col.boolFalse === 'string' && lc(v) === lc(col.boolFalse))) return false;
    const k = lc(v);
    if (['true', 'yes', 'y', '1'].includes(k)) return true;
    if (['false', 'no', 'n', '0'].includes(k)) return false;
    return null;
  }

  const boolLabel = (b) => (b === true ? 'Yes' : b === false ? 'No' : '');

  function display(col, v) {
    if (isEmpty(v)) return '';
    if (col.type === 'boolean') { const b = boolOf(col, v); return b === null ? String(v) : boolLabel(b); }
    if (NUM.has(col.type) || (col.type === 'readonly' && typeof v === 'number')) return fmtNum(v, col);
    if (col.type === 'date' || col.type === 'datetime') return fmtDate(v);
    return String(v);
  }

  function safeHref(v) {
    try { const u = new URL(String(v)); return ['http:', 'https:'].includes(u.protocol) ? u.href : null; } catch { return null; }
  }

  /** Table cell content (DOM node or text). Untrusted values are only ever inserted as text. */
  function cellNode(col, v) {
    if (isEmpty(v)) return h('span.na-cell', {}, '—');
    if (col.type === 'boolean') { const b = boolOf(col, v); return h('span.pill' + (b === true ? '.yes' : b === false ? '.no' : ''), {}, display(col, v)); }
    if (col.type === 'url') { const href = safeHref(v); if (href) return h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, String(v)); }
    if (col.type === 'email' && EMAIL_RE.test(String(v))) return h('a', { href: 'mailto:' + encodeURIComponent(String(v)).replace(/%40/g, '@') }, String(v));
    if (col.type === 'dropdown' || col.type === 'searchable') return h('span.pill', {}, String(v));
    return document.createTextNode(display(col, v));
  }

  /** Client-side validation. Returns an error string or null. */
  function validate(col, raw) {
    if (col.readOnly || col.type === 'readonly') return null;
    if (isEmpty(raw)) return col.required ? 'This field is required.' : null;
    const vr = col.validation || {};
    if (NUM.has(col.type)) {
      const n = typeof raw === 'number' ? raw : Number(String(raw).trim().replace(/,/g, ''));
      if (!Number.isFinite(n)) return 'Enter a valid number.';
      if (col.type === 'integer' && !Number.isInteger(n)) return 'Enter a whole number (no decimals).';
      if (vr.min !== undefined && n < vr.min) return `Must be at least ${vr.min}.`;
      if (vr.max !== undefined && n > vr.max) return `Must be at most ${vr.max}.`;
      return null;
    }
    if (col.type === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(Date.parse(raw)) ? null : 'Pick a valid date.';
    if (col.type === 'datetime') return /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/.test(raw) ? null : 'Pick a valid date and time.';
    if (col.type === 'boolean') return null;
    const s = String(raw);
    if (vr.maxLength !== undefined && s.length > vr.maxLength) return `Must be ${vr.maxLength} characters or fewer.`;
    if (vr.minLength !== undefined && s.trim().length < vr.minLength) return `Must be at least ${vr.minLength} characters.`;
    if (col.type === 'email' && !EMAIL_RE.test(s.trim())) return 'Enter a valid email address.';
    if (col.type === 'url' && !safeHref(s.trim()) && !/^mailto:/i.test(s.trim())) return 'Enter a web address starting with http:// or https://.';
    if (col.type === 'phone') { const d = s.replace(/\D/g, '').length; if (!/^\+?[\d\s().-]{5,22}$/.test(s.trim()) || d < 5 || d > 15) return 'Enter a valid phone number.'; }
    if ((col.type === 'dropdown' || col.type === 'searchable') && col.options.length && !col.options.includes(s)) return 'Pick one of the listed options.';
    return null;
  }

  // ------------------------------------------------------------------ controls

  function searchableControl(col, value, id, emit) {
    const listId = id + '-list';
    const input = h('input.input', { id, type: 'text', role: 'combobox', 'aria-expanded': 'false', 'aria-controls': listId, 'aria-autocomplete': 'list', autocomplete: 'off', placeholder: col.placeholder || 'Start typing…', value: value ?? '' });
    const list = h('div.combo-list', { id: listId, role: 'listbox', hidden: true });
    const wrap = h('div.combo', {}, input, list);
    let items = [];
    let active = -1;
    const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; };
    const choose = (v) => { input.value = v; emit(v); close(); };
    const paint = () => {
      const q = lc(input.value.trim());
      items = col.options.filter((o) => !q || lc(o).includes(q)).slice(0, 80);
      list.replaceChildren(...(items.length
        ? items.map((o, i) => h('div', { role: 'option', id: `${id}-o${i}`, 'aria-selected': String(i === active), onmousedown: (e) => { e.preventDefault(); choose(o); } }, o))
        : [h('div.none', {}, 'No match. Pick one of the listed options.')]));
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    };
    input.addEventListener('input', () => { active = -1; paint(); emit(input.value); });
    input.addEventListener('focus', paint);
    input.addEventListener('blur', () => setTimeout(close, 120));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (list.hidden) paint();
        active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % Math.max(items.length, 1);
        $$('[role=option]', list).forEach((o, i) => o.setAttribute('aria-selected', String(i === active)));
        input.setAttribute('aria-activedescendant', `${id}-o${active}`);
        const o = $$('[role=option]', list)[active]; if (o) o.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter' && !list.hidden && active >= 0) { e.preventDefault(); choose(items[active]); }
      else if (e.key === 'Escape') close();
    });
    return { el: wrap, input };
  }

  /**
   * Build one labelled form field.
   * @returns {{el: HTMLElement, setError(msg), focus(), input}}
   */
  function field(col, value, { id, onChange, onBlur, disabled = false, hideHelp = false } = {}) {
    const fid = id || 'f-' + col.id + '-' + Math.random().toString(36).slice(2, 7);
    const ro = disabled || col.readOnly || col.type === 'readonly';
    const errEl = h('div.err-msg', { id: fid + '-err', role: 'alert', hidden: true });
    let input;
    let node;
    const emit = (v) => { if (onChange) onChange(v); };
    const ph = col.placeholder || '';
    const common = { id: fid, 'aria-describedby': fid + '-help ' + fid + '-err', disabled: ro || null };

    switch (col.type) {
      case 'textarea':
        input = h('textarea.textarea', { ...common, placeholder: ph, rows: 4, maxlength: (col.validation && col.validation.maxLength) || null, oninput: (e) => emit(e.target.value) });
        input.value = value ?? '';
        node = input; break;
      case 'integer': case 'decimal': case 'currency':
        input = h('input.input', { ...common, type: 'number', step: col.type === 'integer' ? '1' : 'any', min: col.validation && col.validation.min, max: col.validation && col.validation.max, inputmode: 'decimal', placeholder: ph, value: value ?? '', oninput: (e) => emit(e.target.value), onwheel: (e) => e.target.blur() });
        node = col.type === 'currency' ? h('div.input-group', {}, h('span.addon', { 'aria-hidden': 'true' }, cfg().currency), input) : input; break;
      case 'date':
        input = h('input.input', { ...common, type: 'date', value: isEmpty(value) ? '' : String(value).slice(0, 10), oninput: (e) => emit(e.target.value) }); node = input; break;
      case 'datetime':
        input = h('input.input', { ...common, type: 'datetime-local', value: isEmpty(value) ? '' : (String(value).length === 10 ? value + 'T00:00' : String(value).slice(0, 16)), oninput: (e) => emit(e.target.value) }); node = input; break;
      case 'boolean': {
        const b = boolOf(col, value);
        const txt = h('span', {}, b === null ? 'Not set' : boolLabel(b));
        input = h('input', { ...common, type: 'checkbox', checked: b === true || null });
        if (b === null) input.indeterminate = true;
        input.addEventListener('change', () => { input.indeterminate = false; txt.textContent = input.checked ? 'Yes' : 'No'; emit(input.checked ? col.boolTrue : col.boolFalse); });
        node = h('label.check', { for: fid }, input, txt); break;
      }
      case 'dropdown': {
        input = h('select.select', { ...common, onchange: (e) => emit(e.target.value) });
        input.append(h('option', { value: '' }, ph || 'Select…'));
        const opts = [...col.options];
        if (!isEmpty(value) && !opts.includes(String(value))) opts.unshift(String(value));
        for (const o of opts) input.append(h('option', { value: o }, o + (col.options.includes(o) ? '' : ' (current value)')));
        input.value = isEmpty(value) ? '' : String(value);
        node = input; break;
      }
      case 'searchable': {
        if (ro) { input = h('input.input', { ...common, type: 'text', value: value ?? '' }); node = input; break; }
        const c = searchableControl(col, value, fid, emit);
        input = c.input; node = c.el; break;
      }
      case 'email': case 'url': case 'phone': case 'text': default:
        input = h('input.input', { ...common, type: col.type === 'email' ? 'email' : col.type === 'url' ? 'url' : col.type === 'phone' ? 'tel' : 'text', inputmode: col.type === 'phone' ? 'tel' : null, autocomplete: 'off', placeholder: ph, maxlength: (col.validation && col.validation.maxLength) || null, value: value ?? '', oninput: (e) => emit(e.target.value) });
        node = input;
    }
    if (ro && input) { input.disabled = true; }
    if (onBlur && input) input.addEventListener('blur', () => onBlur(input));

    const labelText = col.label || col.header;
    const label = h('label.lbl', { for: fid }, labelText, col.required && !ro ? h('span.req', { 'aria-hidden': 'true' }, '*') : null, col.required && !ro ? h('span.sr-only', {}, ' (required)') : null);
    const help = !hideHelp && col.helpText ? h('div.help', { id: fid + '-help' }, h('span', { html: icon('info') }), h('span', {}, col.helpText)) : h('div', { id: fid + '-help', hidden: true });
    const el = h('div.field' + (col.type === 'textarea' ? '.span-2' : ''), {}, label, node, help, errEl);
    return {
      el,
      input,
      focus: () => input && input.focus(),
      setError(msg) {
        errEl.hidden = !msg;
        errEl.replaceChildren(...(msg ? [h('span', { html: icon('alert') }), h('span', {}, msg)] : []));
        if (input) { input.classList.toggle('invalid', Boolean(msg)); input.setAttribute('aria-invalid', msg ? 'true' : 'false'); }
      },
    };
  }

  // ------------------------------------------------------------------ record title helper

  function recordTitle(sheet, rec, idx) {
    for (const c of sheet.columns) {
      if (!['text', 'email', 'dropdown', 'searchable', 'phone'].includes(c.type)) continue;
      const v = rec.v[c.id];
      if (!isEmpty(v)) return String(v);
    }
    for (const c of sheet.columns) { const v = rec.v[c.id]; if (!isEmpty(v)) return display(c, v); }
    return `Record ${idx + 1}`;
  }

  // ------------------------------------------------------------------ Form view

  function formView(ctx, root) {
    const sheet = ctx.sheet();
    const view = ctx.viewState();
    const cols = sheet.columns.filter((c) => c.visible !== false);
    root.replaceChildren();
    if (sheet.empty) { root.append(ctx.emptySheet()); return; }

    const listUl = h('ul', { role: 'listbox', 'aria-label': 'Records' });
    const search = h('input.input', { type: 'search', placeholder: 'Find a record…', 'aria-label': 'Find a record', value: view.recq || '' });
    const formHost = h('div');
    const countEl = h('span.xs.muted', {});
    const listCard = h('div.card.rec-list', {}, h('div.rl-head', {}, search, h('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-top:8px' }, countEl, h('button.btn.btn-sm.btn-primary', { onclick: () => { const k = ctx.addRecord(); view.selected = k; formView(ctx, root); setTimeout(() => { const f = $('input,select,textarea', root.querySelector('.rec-form')); if (f && !f.disabled) f.focus(); }, 30); } }, h('span', { html: icon('plus') }), ' New record'))), listUl);

    root.append(h('div.form-layout', {}, listCard, formHost));

    function filtered() {
      const all = ctx.effective();
      const q = lc((view.recq || '').trim());
      if (!q) return all;
      return all.filter((r) => sheet.columns.some((c) => { const v = r.v[c.id]; return !isEmpty(v) && lc(display(c, v)).includes(q); }));
    }

    function paintList() {
      const rows = filtered();
      const all = ctx.effective();
      const shown = rows.slice(0, 200);
      countEl.textContent = rows.length === all.length ? `${all.length} record${all.length === 1 ? '' : 's'}` : `${rows.length} of ${all.length}`;
      listUl.replaceChildren(...shown.map((r) => {
        const idx = all.indexOf(r);
        return h('li', {}, h('button', { type: 'button', role: 'option', 'aria-selected': String(r.key === view.selected), 'aria-current': r.key === view.selected ? 'true' : 'false', onclick: () => { view.selected = r.key; formView(ctx, root); } },
          h('span.t', {}, recordTitle(sheet, r, idx)),
          r.state === 'new' ? h('span.badge.ok', {}, 'New') : r.state === 'edited' ? h('span.badge.warn', {}, 'Edited') : r.state === 'deleted' ? h('span.badge.danger', {}, 'Deleted') : h('span.xs.muted', {}, '#' + (idx + 1))));
      }));
      if (rows.length > shown.length) listUl.append(h('li.xs.muted', { style: 'padding:8px 12px' }, `Showing the first 200. Search to narrow down.`));
      if (!rows.length) listUl.append(h('li.xs.muted', { style: 'padding:12px' }, all.length ? 'No records match your search.' : 'No records yet. Add the first one.'));
    }
    search.addEventListener('input', () => { view.recq = search.value; paintList(); });

    function paintForm() {
      const all = ctx.effective();
      const list = filtered();
      let rec = all.find((r) => r.key === view.selected);
      if (!rec && all.length && !view.dismissed) { rec = list[0] || all[0]; view.selected = rec && rec.key; }
      if (!rec) {
        formHost.replaceChildren(h('div.card', {}, h('div.empty', {}, h('div.em-ic', { html: icon('form') }), h('h3', {}, 'No record selected'), h('p', {}, all.length ? 'Pick a record on the left to edit it.' : 'This sheet has no records yet.'), h('button.btn.btn-primary', { onclick: () => { view.selected = ctx.addRecord(); formView(ctx, root); } }, h('span', { html: icon('plus') }), ' Add the first record'))));
        return;
      }
      const idx = all.indexOf(rec);
      const li = list.indexOf(rec);
      const deleted = rec.state === 'deleted';
      const fields = new Map();
      const grid = h('div.fields');
      for (const c of cols) {
        const f = field(c, rec.v[c.id], {
          disabled: deleted,
          id: `rf-${c.id}`,
          onChange: (v) => {
            ctx.setValue(rec.key, c.id, v);
            if (view.touched && view.touched[rec.key + c.id]) f.setError(validate(c, v));
            paintList();
            statusBadge();
          },
          onBlur: () => { view.touched = view.touched || {}; view.touched[rec.key + c.id] = true; f.setError(validate(c, ctx.get(rec.key, c.id))); },
        });
        fields.set(c.id, f);
        grid.append(f.el);
      }
      const errs = ctx.errors(rec.key);
      for (const [cid, msg] of Object.entries(errs)) { if (fields.has(cid)) fields.get(cid).setError(msg); }

      const badge = h('span');
      const statusBadge = () => {
        const cur = ctx.effective().find((r) => r.key === rec.key);
        const s = cur ? cur.state : '';
        badge.className = 'badge ' + (s === 'new' ? 'ok' : s === 'edited' ? 'warn' : s === 'deleted' ? 'danger' : 'gray');
        badge.textContent = s === 'new' ? 'New record (not saved yet)' : s === 'edited' ? 'Unsaved changes' : s === 'deleted' ? 'Will be deleted on save' : 'Saved';
        discardBtn.hidden = !(s === 'edited');
      };
      const discardBtn = h('button.btn', { type: 'button', onclick: () => { ctx.discardRecord(rec.key); view.touched = {}; formView(ctx, root); } }, h('span', { html: icon('undo') }), ' Discard changes to this record');
      const delBtn = deleted
        ? h('button.btn', { type: 'button', onclick: () => { ctx.restoreRecord(rec.key); formView(ctx, root); } }, h('span', { html: icon('undo') }), ' Restore record')
        : h('button.btn.btn-danger-outline', { type: 'button', onclick: async () => { if (await ctx.confirmDelete(rec)) { if (rec.state === 'new') { const nxt = list[li + 1] || list[li - 1]; view.selected = nxt && nxt.key; } ctx.deleteRecord(rec.key); formView(ctx, root); } } }, h('span', { html: icon('trash') }), ' Delete record');
      const go = (d) => { const t = list[li + d]; if (t) { view.selected = t.key; formView(ctx, root); } };
      const saveBtn = h('button.btn.btn-primary', { type: 'submit' }, h('span', { html: icon('check') }), ' Save changes');

      const form = h('form.card.rec-form', { novalidate: true, 'aria-label': 'Record form', onsubmit: (e) => { e.preventDefault(); ctx.save(); } },
        h('div.rec-form-head', {}, h('div', {}, h('h3', {}, recordTitle(sheet, rec, idx)), h('span.xs.muted', {}, `Sheet "${sheet.name}" · record ${idx + 1} of ${all.length}`)), badge),
        deleted ? h('div.notice.warn', { style: 'margin-bottom:16px' }, h('span', { html: icon('alert') }), h('span', {}, 'This record is marked for deletion. It disappears from your workbook when you save.')) : null,
        cols.length ? grid : h('div.notice', {}, h('span', { html: icon('info') }), h('span', {}, 'All fields are hidden. Show some in the Fields tab.')),
        h('div.form-actions', {},
          h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, discardBtn, delBtn),
          h('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap' },
            h('div.nav-btns', {}, h('button.btn.btn-icon', { type: 'button', 'aria-label': 'Previous record', disabled: li <= 0 || null, onclick: () => go(-1) }, h('span', { html: icon('left') })), h('button.btn.btn-icon', { type: 'button', 'aria-label': 'Next record', disabled: li < 0 || li >= list.length - 1 || null, onclick: () => go(1) }, h('span', { html: icon('right') }))),
            saveBtn)));
      formHost.replaceChildren(form);
      statusBadge();
    }

    paintList();
    paintForm();
  }

  window.S2A.fields = { field, display, cellNode, validate, boolOf, fmtDate, fmtNum, isEmpty, recordTitle, formView, TYPE_LABEL, TYPE_ICON, NUM };
})();
