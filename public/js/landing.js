(function () {
  'use strict';
  const { $, $$, h, api, icon, esc, renderNav, renderFooter, wireGlobalActions, handleFile, lastWorkbook, openWorkbook } = window.S2A;

  renderNav();
  renderFooter();
  const status = $('#dz-status');
  const progress = $('#dz-progress');
  wireGlobalActions(status, progress);

  // drag & drop
  const dz = $('#dropzone');
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', (e) => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handleFile(f, status, progress);
  });
  // stop the browser from navigating away when a file is dropped outside the zone
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => { if (!dz.contains(e.target)) e.preventDefault(); });

  // explanation tabs
  const demo = $('#explain-demo');
  $$('[data-tab]', demo).forEach((b) => b.addEventListener('click', () => {
    $$('[data-tab]', demo).forEach((x) => { const on = x === b; x.classList.toggle('btn-primary', on); x.setAttribute('aria-selected', String(on)); });
    $$('[data-panel]', demo).forEach((p) => { p.hidden = p.getAttribute('data-panel') !== b.getAttribute('data-tab'); });
  }));

  // ---- workbook manager on the homepage ----
  const { confirmDialog, forgetWorkbook } = window.S2A;
  const wbManagerHost = h('div', { id: 'wb-manager', style: 'margin-top:16px' });
  dz.parentElement.append(wbManagerHost);

  let wbList = [];
  const sel = new Set();

  async function loadWbList() {
    try { wbList = (await api.get('/api/workbooks')).workbooks; } catch { wbList = []; }
    renderWbManager();
  }

  function renderWbManager() {
    if (!wbList.length) { wbManagerHost.replaceChildren(); return; }
    const allChecked = wbList.length > 0 && wbList.every((w) => sel.has(w.id));
    const nSel = sel.size;

    const deleteSelected = async () => {
      if (!nSel) return;
      const noun = nSel === 1 ? '1 workbook' : nSel + ' workbooks';
      const ok = await confirmDialog({
        title: 'Delete ' + noun + '?', danger: true, confirmText: 'Delete ' + noun,
        body: 'The uploaded file, edits, charts and undo history will be removed permanently. This cannot be undone.',
      });
      if (!ok) return;
      for (const id of [...sel]) {
        try {
          await api.del('/api/workbooks/' + id);
          if (lastWorkbook() === id) forgetWorkbook();
          wbList = wbList.filter((w) => w.id !== id);
          sel.delete(id);
        } catch { /* skip */ }
      }
      renderWbManager();
    };

    const rows = wbList.map((w) => {
      const checked = sel.has(w.id);
      const uploaded = w.createdAt ? new Date(w.createdAt).toLocaleString() : null;
      const saved    = w.savedAt   ? new Date(w.savedAt).toLocaleString()   : null;
      const expires  = w.expiresAt ? new Date(w.expiresAt).toLocaleString() : null;
      return h('div.wb-list-row' + (checked ? '.selected' : ''), {},
        h('label.wb-list-check', { title: 'Select to delete' },
          h('input', { type: 'checkbox', checked: checked || null,
            onchange: (e) => { e.target.checked ? sel.add(w.id) : sel.delete(w.id); renderWbManager(); } })),
        h('div.wb-list-info', {},
          h('b', {}, w.fileName),
          h('div.xs.muted', {},
            h('span', {}, w.sheets + ' sheet' + (w.sheets === 1 ? '' : 's')),
            uploaded ? [h('span.wb-list-sep', {}, '·'), h('span', {}, 'Uploaded ' + uploaded)] : null,
            saved    ? [h('span.wb-list-sep', {}, '·'), h('span', {}, 'Saved ' + saved)]       : null,
            expires  ? [h('span.wb-list-sep', {}, '·'), h('span', { style: 'color:var(--warn)' }, 'Expires ' + expires)] : null)),
        h('div.wb-list-actions', {},
          h('button.btn.btn-sm.btn-primary', { type: 'button', onclick: () => openWorkbook(w.id) },
            h('span', { html: icon('sheet') }), ' Open')));
    });

    wbManagerHost.replaceChildren(
      h('div.card', { style: 'margin-top:4px;padding:0;overflow:hidden' },
        h('div.wb-list-header', {},
          h('div.wb-list-header-left', {},
            h('label.wb-list-check', { title: 'Select all' },
              h('input', { type: 'checkbox', checked: allChecked || null,
                onchange: (e) => { wbList.forEach((w) => e.target.checked ? sel.add(w.id) : sel.delete(w.id)); renderWbManager(); } })),
            h('b', {}, 'Your workbooks (' + wbList.length + ')')),
          nSel > 0
            ? h('button.btn.btn-sm.btn-danger', { type: 'button', onclick: deleteSelected },
                h('span', { html: icon('trash') }), ' Delete selected (' + nSel + ')')
            : h('span.xs.muted', {}, 'Tick a checkbox to delete')),
        h('div.wb-list-body', {}, ...rows)));
  }

  loadWbList();

  // pricing preview from the server config (single source of truth)
  api.get('/api/config').then((cfg) => {
    const host = $('#price-preview');
    const perks = {
      free: ['Upload workbooks up to ' + cfg.plans[0].limits.maxUploadMB + ' MB', cfg.plans[0].limits.maxSheets + ' sheets · ' + cfg.plans[0].limits.maxRowsPerSheet + ' rows each', 'Forms, table, field editor', 'Up to ' + cfg.plans[0].limits.autoCharts + ' auto charts + explanations', 'Download updated Excel'],
      pro: ['Larger workbooks (' + cfg.plans[1].limits.maxUploadMB + ' MB)', cfg.plans[1].limits.maxSheets + ' sheets · ' + cfg.plans[1].limits.maxRowsPerSheet.toLocaleString('en-IN') + ' rows each', 'More charts (' + cfg.plans[1].limits.autoCharts + ' auto, ' + cfg.plans[1].limits.customCharts + ' custom)', 'Everything in Free'],
      business: ['Highest limits (' + cfg.plans[2].limits.maxUploadMB + ' MB)', cfg.plans[2].limits.maxSheets + ' sheets per workbook', cfg.plans[2].limits.customCharts + ' custom charts per sheet', 'Everything in Pro'],
    };
    host.replaceChildren(...cfg.plans.map((p) => h('div.card.price-card' + (p.id === 'pro' ? '.featured' : ''), {},
      p.id === 'pro' ? h('span.badge.ribbon', {}, 'Most popular (proposed)') : null,
      h('h3', {}, p.name),
      h('div.price', {}, p.priceLabel, ' ', h('small', {}, p.id === 'free' ? '' : '/month')),
      h('p.muted.small', {}, p.tagline),
      h('ul', {}, perks[p.id].map((t) => h('li', { html: icon('check') + '<span>' + esc(t) + '</span>' }))),
      p.id === 'free' ? h('button.btn.btn-primary', { 'data-act': 'upload' }, 'Start free') : h('a.btn', { href: '/pricing#' + p.id }, 'See details'))));
  }).catch(() => { $('#price-preview').replaceChildren(h('p.muted.center', {}, 'See the pricing page for plan details.')); });
})();
