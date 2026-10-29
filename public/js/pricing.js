(function () {
  'use strict';
  const { $, h, api, icon, esc, renderNav, renderFooter, wireGlobalActions, toast } = window.S2A;
  renderNav('pricing');
  renderFooter();
  wireGlobalActions($('#dz-status'), null);

  const fmtN = (n) => Number(n).toLocaleString('en-IN');
  const FEATURES = [
    ['Max file size', (l) => l.maxUploadMB + ' MB'],
    ['Sheets per workbook', (l) => fmtN(l.maxSheets)],
    ['Records per sheet', (l) => fmtN(l.maxRowsPerSheet)],
    ['Columns per sheet', (l) => fmtN(l.maxColumns)],
    ['Active workbooks at once', (l) => fmtN(l.workspaces)],
    ['Automatic charts per sheet', (l) => fmtN(l.autoCharts)],
    ['Saved custom charts per sheet', (l) => fmtN(l.customCharts)],
    ['Forms, table, field editor, undo', () => true],
    ['Plain-language chart explanations', () => true],
    ['Download updated Excel & CSV', () => true],
    ['Reusable templates', (l) => l.templates ? 'Planned' : false],
    ['Custom branding', (l) => l.branding ? 'Planned' : false],
  ];

  function cell(v) {
    if (v === true) return '<span class="yes">Included</span>';
    if (v === false) return '<span class="muted">—</span>';
    if (v === 'Planned') return '<span class="badge gray">Planned</span>';
    return esc(v);
  }

  api.get('/api/config').then((cfg) => {
    $('#disclaimer').innerHTML = icon('info') + '<span>' + esc(cfg.disclaimer) + '</span>';
    const perks = (p) => FEATURES.slice(0, 7).map(([label, fn]) => ({ label, v: fn(p.limits) }));
    $('#plans').replaceChildren(...cfg.plans.map((p) => {
      const isActive = cfg.activePlan === p.id;
      const card = h('div.card.price-card' + (p.id === 'pro' ? '.featured' : ''), { id: p.id },
        p.id === 'pro' ? h('span.badge.ribbon', {}, 'Proposed best value') : null,
        h('div', { style: 'display:flex;justify-content:space-between;align-items:center' }, h('h3', { style: 'margin:0' }, p.name), isActive ? h('span.badge.ok', {}, 'Active on this server') : null),
        h('div.price', {}, p.priceLabel, p.id === 'free' ? '' : h('small', {}, ' /month')),
        h('p.muted.small', {}, p.tagline + (p.id === 'free' ? '' : ' (' + p.period + ')')),
        h('ul', {}, perks(p).map((x) => h('li', { html: icon('check') + '<span>' + esc(x.label) + ': <b>' + esc(x.v) + '</b></span>' }))),
        p.id === 'free'
          ? h('button.btn.btn-primary', { 'data-act': 'upload' }, 'Start free')
          : h('button.btn' + (p.id === 'pro' ? '.btn-primary' : ''), { onclick: () => interest(p.id, p.name) }, 'Notify me about ' + p.name));
      return card;
    }));

    $('#compare').innerHTML =
      '<thead><tr><th>Feature</th>' + cfg.plans.map((p) => '<th' + (p.id === 'pro' ? ' class="us"' : '') + '>' + esc(p.name) + '</th>').join('') + '</tr></thead><tbody>' +
      FEATURES.map(([label, fn]) => '<tr><th scope="row">' + esc(label) + '</th>' + cfg.plans.map((p) => '<td' + (p.id === 'pro' ? ' class="us"' : '') + '>' + cell(fn(p.limits)) + '</td>').join('') + '</tr>').join('') + '</tbody>';

    const l = cfg.limits;
    const used = cfg.usage.workbooks;
    $('#usage').innerHTML =
      '<p style="margin:0 0 6px">Active workbooks: <b>' + used + ' of ' + l.workspaces + '</b> (' + esc(cfg.plan) + ' plan)</p>' +
      '<div class="meter"><i style="width:' + Math.min(100, Math.round((used / l.workspaces) * 100)) + '%"></i></div>' +
      '<p class="small muted" style="margin:6px 0 0">Workbooks are deleted automatically after ' + cfg.workspaceTtlHours + ' hours of inactivity.</p>';
    $('#planned').replaceChildren(...cfg.planned.map((t) => h('li', {}, t)));
  }).catch(() => { $('#plans').replaceChildren(h('p.muted', {}, 'Could not load plans. Please refresh.')); });

  async function interest(plan, name) {
    try {
      const r = await api.post('/api/upgrade-interest', { plan });
      const box = $('#interest');
      box.classList.remove('hidden');
      box.innerHTML = icon('check') + '<span></span>';
      box.lastChild.textContent = r.message;
      if (r.available && r.checkoutUrl) {
        const a = h('a.btn.btn-sm.btn-primary', { href: r.checkoutUrl, rel: 'noopener noreferrer', style: 'margin-left:auto' }, 'Continue to checkout');
        box.append(a);
      }
      box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (e) { toast('err', 'Could not send', e.message); }
  }
})();
