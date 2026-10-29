/* Data table view: search, column filters, sorting, pagination, row state highlighting. */
(function () {
  'use strict';
  const { h, $, icon } = window.S2A;
  const F = () => window.S2A.fields;
  const PAGE_SIZES = [10, 25, 50, 100];
  const lc = (v) => String(v).toLowerCase();
  const NUMTYPES = new Set(['integer', 'decimal', 'currency']);

  function sortValue(col, v) {
    if (F().isEmpty(v)) return null;
    if (NUMTYPES.has(col.type) || typeof v === 'number') return Number(v);
    if (col.type === 'boolean') { const b = F().boolOf(col, v); return b === null ? null : b ? 1 : 0; }
    return lc(v);
  }

  function compare(col, dir) {
    return (a, b) => {
      const x = sortValue(col, a.v[col.id]);
      const y = sortValue(col, b.v[col.id]);
      if (x === null && y === null) return 0;
      if (x === null) return 1;      // blanks always last
      if (y === null) return -1;
      const r = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
      return dir === 'desc' ? -r : r;
    };
  }

  function matchFilter(col, f, v) {
    const empty = F().isEmpty(v);
    if (f.op === 'blank') return empty;
    if (f.op === 'notblank') return !empty;
    if (empty) return false;
    const val = String(f.value ?? '');
    if (val === '') return true;
    if (f.op === 'eq') return lc(F().display(col, v)) === lc(val) || lc(v) === lc(val);
    if (f.op === 'neq') return lc(F().display(col, v)) !== lc(val) && lc(v) !== lc(val);
    if (f.op === 'contains') return lc(F().display(col, v)).includes(lc(val)) || lc(v).includes(lc(val));
    if (f.op === 'gte' || f.op === 'lte') {
      const a = NUMTYPES.has(col.type) ? Number(v) : String(v);
      const b = NUMTYPES.has(col.type) ? Number(val) : val;
      if (typeof a === 'number' && !Number.isFinite(b)) return true;
      return f.op === 'gte' ? a >= b : a <= b;
    }
    return true;
  }

  function filteredRows(ctx, view) {
    const sheet = ctx.sheet();
    let rows = ctx.effective();
    const q = lc((view.q || '').trim());
    if (q) rows = rows.filter((r) => sheet.columns.some((c) => { const v = r.v[c.id]; return !F().isEmpty(v) && lc(F().display(c, v)).includes(q); }));
    for (const f of view.filters || []) {
      const col = sheet.columns.find((c) => c.id === f.col);
      if (col) rows = rows.filter((r) => matchFilter(col, f, r.v[col.id]));
    }
    if (view.showChanged) rows = rows.filter((r) => r.state !== 'saved');
    if (view.sortCol) {
      const col = sheet.columns.find((c) => c.id === view.sortCol);
      if (col) rows = [...rows].sort(compare(col, view.sortDir));
    }
    return rows;
  }

  function dataView(ctx, root) {
    const sheet = ctx.sheet();
    const view = ctx.viewState();
    view.page = view.page || 1;
    view.pageSize = view.pageSize || 25;
    view.filters = view.filters || [];
    root.replaceChildren();
    if (sheet.empty) { root.append(ctx.emptySheet()); return; }

    const cols = sheet.columns.filter((c) => c.inTable !== false && c.visible !== false);
    const search = h('input.input', { type: 'search', placeholder: 'Search every column…', 'aria-label': 'Search records', value: view.q || '' });
    const tableHost = h('div');
    const filterHost = h('div');
    const filterBtn = h('button.btn', { type: 'button', 'aria-expanded': String(Boolean(view.filterOpen)), onclick: () => { view.filterOpen = !view.filterOpen; paintFilters(); filterBtn.setAttribute('aria-expanded', String(view.filterOpen)); } },
      h('span', { html: icon('filter') }), ' Filters', view.filters.length ? h('span.badge', {}, String(view.filters.length)) : null);
    const changedChk = h('label.mini-check', {}, h('input', { type: 'checkbox', checked: view.showChanged || null, onchange: (e) => { view.showChanged = e.target.checked; view.page = 1; paint(); } }), ' Unsaved only');

    root.append(
      h('div.toolbar', {},
        h('div.search', {}, h('span', { html: icon('search') }), search),
        filterBtn,
        changedChk,
        h('div', { style: 'margin-left:auto;display:flex;gap:8px' },
          h('button.btn.btn-primary', { type: 'button', onclick: () => { const k = ctx.addRecord(); ctx.openRecord(k); } }, h('span', { html: icon('plus') }), ' Add record'))),
      filterHost, tableHost);

    search.addEventListener('input', () => { view.q = search.value; view.page = 1; paint(); });

    function paintFilters() {
      if (!view.filterOpen) { filterHost.replaceChildren(); return; }
      const colOpts = (sel) => cols.map((c) => h('option', { value: c.id, selected: sel === c.id || null }, c.label));
      const rows = view.filters.map((f, i) => {
        const col = sheet.columns.find((c) => c.id === f.col) || cols[0];
        const opSel = h('select.select', { 'aria-label': 'Filter condition', onchange: (e) => { f.op = e.target.value; view.page = 1; paint(); paintFilters(); } },
          [['contains', 'contains'], ['eq', 'is'], ['neq', 'is not'], ['gte', 'at least'], ['lte', 'at most'], ['blank', 'is empty'], ['notblank', 'is not empty']].map(([v, t]) => h('option', { value: v, selected: f.op === v || null }, t)));
        const needVal = !['blank', 'notblank'].includes(f.op);
        const valEl = needVal ? (['dropdown', 'searchable'].includes(col.type) && col.options.length && ['eq', 'neq'].includes(f.op)
          ? h('select.select', { 'aria-label': 'Filter value', onchange: (e) => { f.value = e.target.value; view.page = 1; paint(); } }, h('option', { value: '' }, 'Any'), col.options.map((o) => h('option', { value: o, selected: f.value === o || null }, o)))
          : h('input.input', { 'aria-label': 'Filter value', value: f.value || '', placeholder: 'Value', oninput: (e) => { f.value = e.target.value; view.page = 1; paint(); } })) : h('span.muted.small', {}, '');
        return h('div.filter-row', {},
          h('select.select', { 'aria-label': 'Filter column', onchange: (e) => { f.col = e.target.value; f.value = ''; paintFilters(); paint(); } }, colOpts(f.col)),
          opSel, valEl,
          h('button.btn.btn-ghost.btn-icon', { type: 'button', 'aria-label': 'Remove filter', onclick: () => { view.filters.splice(i, 1); view.page = 1; paintFilters(); paint(); updateFilterBadge(); } }, h('span', { html: icon('x') })));
      });
      filterHost.replaceChildren(h('div.card.filter-panel', {},
        ...rows,
        view.filters.length ? null : h('p.muted.small', { style: 'margin:0' }, 'Show only the records that match your conditions.'),
        h('div', { style: 'display:flex;gap:8px' },
          h('button.btn.btn-sm', { type: 'button', onclick: () => { view.filters.push({ col: cols[0].id, op: 'contains', value: '' }); paintFilters(); updateFilterBadge(); } }, h('span', { html: icon('plus') }), ' Add condition'),
          view.filters.length ? h('button.btn.btn-sm.btn-ghost', { type: 'button', onclick: () => { view.filters = []; view.page = 1; paintFilters(); paint(); updateFilterBadge(); } }, 'Clear all') : null)));
    }
    function updateFilterBadge() {
      const b = filterBtn.querySelector('.badge');
      if (b) b.remove();
      if (view.filters.length) filterBtn.append(h('span.badge', {}, String(view.filters.length)));
    }

    function paint() {
      const all = ctx.effective();
      const rows = filteredRows(ctx, view);
      const total = rows.length;
      const pages = Math.max(1, Math.ceil(total / view.pageSize));
      if (view.page > pages) view.page = pages;
      const start = (view.page - 1) * view.pageSize;
      const slice = rows.slice(start, start + view.pageSize);

      if (!all.length) {
        tableHost.replaceChildren(h('div.card', {}, h('div.empty', {}, h('div.em-ic', { html: icon('sheet') }), h('h3', {}, 'No records yet'), h('p', {}, 'This sheet has column names but no rows. Add the first record to get started.'), h('button.btn.btn-primary', { onclick: () => ctx.openRecord(ctx.addRecord()) }, h('span', { html: icon('plus') }), ' Add the first record'))));
        return;
      }

      const head = h('tr', {},
        ...cols.map((c) => {
          const active = view.sortCol === c.id;
          return h('th', { scope: 'col', 'aria-sort': active ? (view.sortDir === 'desc' ? 'descending' : 'ascending') : 'none' },
            h('button', { type: 'button', title: 'Sort by ' + c.label, onclick: () => {
              if (view.sortCol === c.id) { if (view.sortDir === 'asc') view.sortDir = 'desc'; else { view.sortCol = null; view.sortDir = 'asc'; } } else { view.sortCol = c.id; view.sortDir = 'asc'; }
              paint();
            } }, h('span', {}, c.label), h('span.th-type', {}, F().TYPE_LABEL[c.type]), h('span', { html: active ? icon(view.sortDir === 'desc' ? 'down' : 'up') : '', style: 'margin-left:auto;color:var(--brand)' })));
        }),
        h('th.act', { scope: 'col' }, h('span.sr-only', {}, 'Actions')));

      const body = slice.map((r) => {
        const tr = h('tr', { class: r.state === 'new' ? 'row-new' : r.state === 'edited' ? 'row-edited' : r.state === 'deleted' ? 'row-deleted' : '' + (ctx.errors(r.key) && Object.keys(ctx.errors(r.key)).length ? ' row-error' : '') });
        if (ctx.errors(r.key) && Object.keys(ctx.errors(r.key)).length) tr.classList.add('row-error');
        for (const c of cols) {
          const td = h('td', { class: NUMTYPES.has(c.type) ? 'num' : '', title: F().isEmpty(r.v[c.id]) ? '' : F().display(c, r.v[c.id]) }, F().cellNode(c, r.v[c.id]));
          if (r.changed && r.changed.has(c.id)) td.classList.add('cell-edited');
          tr.append(td);
        }
        const idx = all.indexOf(r) + 1;
        tr.append(h('td.act', {}, h('div', { style: 'display:flex;gap:4px' },
          r.state === 'deleted'
            ? h('button.btn.btn-sm', { type: 'button', onclick: () => { ctx.restoreRecord(r.key); paint(); } }, 'Restore')
            : [h('button.btn.btn-sm.btn-icon', { type: 'button', 'aria-label': 'Edit record ' + idx, title: 'Edit', onclick: () => ctx.openRecord(r.key) }, h('span', { html: icon('edit') })),
               h('button.btn.btn-sm.btn-icon.btn-danger-outline', { type: 'button', 'aria-label': 'Delete record ' + idx, title: 'Delete', onclick: async () => { if (await ctx.confirmDelete(r)) { ctx.deleteRecord(r.key); paint(); } } }, h('span', { html: icon('trash') }))])));
        tr.addEventListener('dblclick', () => { if (r.state !== 'deleted') ctx.openRecord(r.key); });
        return tr;
      });

      const pager = h('div.pager', {},
        h('span', {}, total ? `Showing ${start + 1}–${Math.min(total, start + view.pageSize)} of ${total.toLocaleString('en-IN')}${total !== all.length ? ` (filtered from ${all.length.toLocaleString('en-IN')})` : ''}` : 'No matching records'),
        h('div.pg', {},
          h('label.xs.muted', { for: 'pgsize' }, 'Rows per page'),
          h('select.select', { id: 'pgsize', style: 'width:auto;padding:.35em .6em', onchange: (e) => { view.pageSize = +e.target.value; view.page = 1; paint(); } }, PAGE_SIZES.map((n) => h('option', { value: n, selected: n === view.pageSize || null }, n))),
          h('button.btn.btn-sm.btn-icon', { type: 'button', 'aria-label': 'First page', disabled: view.page <= 1 || null, onclick: () => { view.page = 1; paint(); } }, '«'),
          h('button.btn.btn-sm.btn-icon', { type: 'button', 'aria-label': 'Previous page', disabled: view.page <= 1 || null, onclick: () => { view.page -= 1; paint(); } }, h('span', { html: icon('left') })),
          h('span', {}, `Page ${view.page} of ${pages}`),
          h('button.btn.btn-sm.btn-icon', { type: 'button', 'aria-label': 'Next page', disabled: view.page >= pages || null, onclick: () => { view.page += 1; paint(); } }, h('span', { html: icon('right') })),
          h('button.btn.btn-sm.btn-icon', { type: 'button', 'aria-label': 'Last page', disabled: view.page >= pages || null, onclick: () => { view.page = pages; paint(); } }, '»')));

      const emptyMsg = total ? null : h('div.empty', {}, h('div.em-ic', { html: icon('search') }), h('h3', {}, 'No records match'), h('p', {}, 'Try a different search or clear the filters.'), h('button.btn', { onclick: () => { view.q = ''; view.filters = []; view.showChanged = false; search.value = ''; changedChk.querySelector('input').checked = false; paint(); paintFilters(); updateFilterBadge(); } }, 'Clear search and filters'));

      tableHost.replaceChildren(h('div.card.table-card', {},
        h('div.tbl-scroll', { tabindex: '0', role: 'region', 'aria-label': `${sheet.name} records` },
          cols.length ? h('table.data', {}, h('caption.sr-only', {}, `${sheet.name} records`), h('thead', {}, head), h('tbody', {}, ...body)) : h('div.empty', {}, 'All columns are hidden in the table. Show some in the Fields tab.'),
          emptyMsg),
        pager));
    }

    paintFilters();
    paint();
  }

  window.S2A.tables = { dataView, filteredRows };
})();
