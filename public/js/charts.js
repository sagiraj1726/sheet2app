/* Insights view: Enable Insights switch, KPI cards, ECharts rendering, plain-language explain panels, chart builder. */
(function () {
  'use strict';
  const { h, $, $$, icon, esc } = window.S2A;
  const COLORS = ['#4f46e5', '#0d9488', '#f59e0b', '#e11d48', '#7c3aed', '#0ea5e9', '#84cc16', '#f97316', '#14b8a6', '#a855f7'];
  const live = new Set();

  function disposeAll() { live.forEach((c) => { try { c.dispose(); } catch { /* gone */ } }); live.clear(); }
  window.addEventListener('resize', () => live.forEach((c) => { try { c.resize(); } catch { /* gone */ } }));

  const money = (fmt) => (fmt && fmt.prefix) || '';
  const num = (n, fmt) => (typeof n === 'number' ? money(fmt) + n.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : String(n));
  const percent = (a, b) => (b ? ((a / b) * 100).toLocaleString('en-IN', { maximumFractionDigits: 1 }) + '%' : '');

  function option(c) {
    const text = { fontFamily: 'Segoe UI, system-ui, sans-serif', color: '#2b3350' };
    const base = {
      color: COLORS, textStyle: text, aria: { enabled: true },
      animationDuration: 500, grid: { left: 12, right: 24, top: 30, bottom: 12, containLabel: true },
      tooltip: { confine: true, backgroundColor: '#151a30', borderWidth: 0, textStyle: { color: '#fff', fontSize: 13 }, extraCssText: 'border-radius:10px;padding:10px 12px;box-shadow:0 8px 24px rgba(0,0,0,.25)' },
    };
    const f = c.format;
    const axisName = (n) => ({ name: n, nameLocation: 'middle', nameGap: 34, nameTextStyle: { color: '#566077', fontWeight: 600 } });

    if (c.kind === 'pie') {
      const total = c.series[0].data.reduce((a, b) => a + b, 0);
      return {
        ...base, legend: { type: 'scroll', bottom: 0, textStyle: { color: '#2b3350' } },
        tooltip: { ...base.tooltip, trigger: 'item', formatter: (p) => `<b>${esc(p.name)}</b><br>${esc(c.series[0].name)}: <b>${num(p.value, f)}</b><br>Share: <b>${percent(p.value, total)}</b>` },
        series: [{ type: 'pie', radius: c.type === 'doughnut' ? ['48%', '72%'] : ['0%', '72%'], center: ['50%', '45%'], avoidLabelOverlap: true, itemStyle: { borderColor: '#fff', borderWidth: 2, borderRadius: 4 }, label: { formatter: '{b}\n{d}%', color: '#2b3350' }, emphasis: { scale: true, itemStyle: { shadowBlur: 14, shadowColor: 'rgba(0,0,0,.25)' } }, data: c.categories.map((n, i) => ({ name: n, value: c.series[0].data[i] })) }],
      };
    }
    if (c.kind === 'scatter') {
      return {
        ...base, grid: { ...base.grid, bottom: 30 },
        tooltip: { ...base.tooltip, trigger: 'item', formatter: (p) => `${esc(c.axis.x)}: <b>${num(p.value[0], c.xFormat)}</b><br>${esc(c.axis.y)}: <b>${num(p.value[1], f)}</b>` },
        xAxis: { type: 'value', scale: true, ...axisName(c.axis.x), splitLine: { lineStyle: { color: '#eef0f6' } } },
        yAxis: { type: 'value', scale: true, ...axisName(c.axis.y), nameGap: 48, splitLine: { lineStyle: { color: '#eef0f6' } } },
        dataZoom: [{ type: 'inside' }],
        series: [{ type: 'scatter', symbolSize: 10, itemStyle: { opacity: 0.75 }, data: c.points, emphasis: { scale: 1.5 } }],
      };
    }
    if (c.kind === 'box') {
      return {
        ...base, grid: { ...base.grid, bottom: 30 },
        tooltip: { ...base.tooltip, trigger: 'item', formatter: (p) => {
          if (p.seriesType === 'scatter') return `Unusual value: <b>${num(p.value[1], f)}</b>`;
          const v = p.value.slice(1);
          return `<b>${esc(p.name)}</b> (${c.counts[p.dataIndex]} values)<br>Highest typical: <b>${num(v[4], f)}</b><br>Upper quarter starts: ${num(v[3], f)}<br>Middle (median): <b>${num(v[2], f)}</b><br>Lower quarter ends: ${num(v[1], f)}<br>Lowest typical: <b>${num(v[0], f)}</b>`;
        } },
        xAxis: { type: 'category', data: c.categories, ...axisName(c.axis.x), axisLabel: { interval: 0, width: 90, overflow: 'truncate' } },
        yAxis: { type: 'value', scale: true, ...axisName(c.axis.y), nameGap: 50, splitLine: { lineStyle: { color: '#eef0f6' } } },
        series: [{ type: 'boxplot', data: c.boxes, itemStyle: { color: '#e0e4ff', borderColor: '#4f46e5', borderWidth: 2 } }, { type: 'scatter', data: c.outliers, itemStyle: { color: '#e11d48' }, symbolSize: 8 }],
      };
    }
    // cartesian
    const horizontal = c.type === 'hbar';
    const isLine = c.type === 'line' || c.type === 'area';
    const cat = { type: 'category', data: c.categories, ...(horizontal ? {} : axisName(c.axis.x)), inverse: horizontal, axisLabel: { color: '#566077', interval: c.categories.length > 14 ? 'auto' : 0, width: horizontal ? 120 : 70, overflow: 'truncate', rotate: !horizontal && c.categories.length > 8 ? 30 : 0 }, axisTick: { alignWithLabel: true } };
    const val = { type: 'value', ...(horizontal ? axisName(c.axis.y) : { ...axisName(c.axis.y), nameGap: 52 }), splitLine: { lineStyle: { color: '#eef0f6' } }, axisLabel: { formatter: (v) => money(f) + Number(v).toLocaleString('en-IN', { notation: Math.abs(v) >= 1e7 ? 'compact' : 'standard' }) } };
    const multi = c.series.length > 1;
    return {
      ...base,
      grid: { ...base.grid, bottom: (!horizontal && c.categories.length > 8 ? 56 : 36) + (multi ? 30 : 0) },
      legend: multi ? { type: 'scroll', bottom: 0, textStyle: { color: '#2b3350' } } : undefined,
      tooltip: { ...base.tooltip, trigger: 'axis', axisPointer: { type: isLine ? 'line' : 'shadow' },
        formatter: (ps) => {
          const total = ps.reduce((a, p) => a + (typeof p.value === 'number' ? p.value : 0), 0);
          const cnt = c.counts && c.counts[ps[0].dataIndex];
          const xf = c.xFormat;
          const title = c.type === 'histogram' ? `${esc(ps[0].name)} (${esc(c.axis.x)})` : esc(ps[0].name);
          return `<b>${title}</b>` + ps.map((p) => `<br>${p.marker} ${esc(p.seriesName)}: <b>${c.type === 'histogram' ? Number(p.value).toLocaleString('en-IN') : num(p.value, f)}</b>`).join('') +
            (multi ? `<br>Total: <b>${num(total, f)}</b>` : (c.total && c.type !== 'line' && c.type !== 'area' ? `<br>Share of total: <b>${percent(ps[0].value, c.total)}</b>` : '')) +
            (cnt && c.explain && /average|lowest|highest/i.test(c.axis.y) ? `<br><span style="opacity:.75">Based on ${cnt} record${cnt === 1 ? '' : 's'}</span>` : '') + (xf ? '' : '');
        } },
      xAxis: horizontal ? val : cat,
      yAxis: horizontal ? cat : val,
      dataZoom: c.categories.length > 40 ? [{ type: 'inside' }, { type: 'slider', height: 18, bottom: 4 }] : undefined,
      series: c.series.map((s, i) => ({
        name: s.name, type: isLine ? 'line' : 'bar', data: s.data, stack: c.stacked ? 'total' : undefined,
        smooth: false, symbolSize: isLine ? 8 : undefined, areaStyle: c.type === 'area' ? { opacity: 0.2 } : undefined, lineStyle: isLine ? { width: 3 } : undefined,
        barMaxWidth: c.type === 'histogram' ? 80 : 46, barCategoryGap: c.type === 'histogram' ? '4%' : '30%',
        itemStyle: { borderRadius: c.stacked ? 0 : horizontal ? [0, 6, 6, 0] : [6, 6, 0, 0] },
        emphasis: { focus: 'series' },
        ...(c.series.length === 1 && !isLine && c.categories.length <= 1 ? {} : {}),
      })),
    };
  }

  function chartCard(c, ctx, { saved = false, wide = false, onEdit, onDelete } = {}) {
    const canvas = h('div.cc-canvas', { role: 'img', 'aria-label': c.ok ? `${c.title}. ${c.explain.what}` : c.title });
    const panelHost = h('div');
    const card = h('article.card.chart-card' + (wide ? '.wide' : ''), { 'data-chart': c.id },
      h('div.cc-head', {}, h('div', {}, h('h3', {}, c.title), h('div.sub', {}, (c.typeLabel || '') + (c.ok && c.recordsInChart !== undefined ? ` · ${c.recordsInChart} record${c.recordsInChart === 1 ? '' : 's'}` : ''))),
        h('div', { style: 'display:flex;gap:4px;align-items:center' }, saved ? h('span.badge.teal', {}, 'Saved') : h('span.badge.gray', {}, 'Suggested'),
          c.ok ? h('div.help-pop', {}, h('button.btn.btn-ghost.btn-sm.btn-icon', { type: 'button', 'aria-label': 'Quick tip: how to read this chart' }, h('span', { html: icon('info') })), h('div.pop', { role: 'tooltip' }, c.explain.howToRead)) : null)),
      c.ok ? canvas : h('div.cc-unavailable', {}, h('div.em-ic', { style: 'width:52px;height:52px;margin:0 auto 10px;border-radius:16px;display:grid;place-items:center;background:var(--warn-50);color:var(--warn)', html: icon('alert') }), h('b', {}, 'This chart can’t be shown'), h('p.small', { style: 'margin:6px 0 0' }, c.reason)),
      panelHost);

    if (c.ok) {
      const panels = { explain: false, mean: false };
      const render = () => {
        const kids = [];
        if (panels.explain) kids.push(h('div', {}, h('h4', {}, 'What this chart shows'), h('p', {}, c.explain.what), h('h4', { style: 'margin-top:10px' }, 'How to read it'), h('p', {}, c.explain.howToRead), c.explain.pattern ? h('div', {}, h('h4', { style: 'margin-top:10px' }, 'Main pattern'), h('p', {}, c.explain.pattern)) : null,
          c.explain.limitations.length ? h('div', {}, h('h4', { style: 'margin-top:10px' }, 'Things to keep in mind'), h('ul', {}, c.explain.limitations.map((l) => h('li', {}, l)))) : null));
        if (panels.mean) kids.push(h('div.quote', {}, h('h4', { style: 'color:#0b6b62' }, 'What does this mean?'), h('p', {}, c.meaning)));
        panelHost.replaceChildren(...(kids.length ? [h('div.cc-panel', { style: 'margin-top:8px' }, ...kids)] : []));
      };
      const mk = (key, label, ic) => {
        const b = h('button.btn.btn-sm', { type: 'button', 'aria-expanded': 'false', onclick: () => { panels[key] = !panels[key]; b.setAttribute('aria-expanded', String(panels[key])); b.classList.toggle('btn-primary', panels[key]); render(); } }, h('span', { html: icon(ic) }), ' ' + label);
        return b;
      };
      const actions = h('div.cc-actions', {}, mk('explain', 'Explain this chart', 'bulb'), mk('mean', 'What does this mean?', 'wand'),
        h('span', { style: 'margin-left:auto;display:flex;gap:6px;flex-wrap:wrap' },
          h('button.btn.btn-sm', { type: 'button', title: 'Download this chart as a picture', onclick: () => savePng(c, ctx) }, h('span', { html: icon('image') }), ' PNG'),
          onEdit ? h('button.btn.btn-sm', { type: 'button', onclick: () => onEdit(c) }, h('span', { html: icon('edit') }), ' Customise') : null,
          onDelete ? h('button.btn.btn-sm.btn-danger-outline', { type: 'button', 'aria-label': 'Delete chart ' + c.title, onclick: () => onDelete(c) }, h('span', { html: icon('trash') })) : null));
      card.append(actions);
      requestAnimationFrame(() => {
        if (!window.echarts || !canvas.isConnected) return;
        const chart = window.echarts.init(canvas, null, { renderer: 'canvas' });
        chart.setOption(option(c));
        chart.__s2a = c;
        canvas.__chart = chart;
        live.add(chart);
      });
    } else if (onDelete) {
      card.append(h('div.cc-actions', {}, onEdit ? h('button.btn.btn-sm', { type: 'button', onclick: () => onEdit(c) }, 'Customise') : null, h('button.btn.btn-sm.btn-danger-outline', { type: 'button', onclick: () => onDelete(c) }, 'Delete')));
    }
    return card;
  }

  function savePng(c, ctx) {
    const canvas = document.querySelector(`[data-chart="${CSS.escape(c.id)}"] .cc-canvas`);
    const chart = canvas && canvas.__chart;
    if (!chart) return;
    const url = chart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#ffffff' });
    const a = h('a', { href: url, download: (c.title || 'chart').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() + '.png' });
    document.body.append(a); a.click(); a.remove();
  }

  // ------------------------------------------------------------------ view

  async function insightsView(ctx, root) {
    disposeAll();
    const sheet = ctx.sheet();
    root.replaceChildren();
    if (sheet.empty) { root.append(ctx.emptySheet()); return; }
    const on = ctx.insightsOn();

    const sw = h('label.switch', {}, h('input', { type: 'checkbox', role: 'switch', checked: on || null, 'aria-label': 'Enable Insights', onchange: (e) => { ctx.setInsights(e.target.checked); insightsView(ctx, root); } }), h('span.track'), h('span', {}, 'Enable Insights'));
    root.append(h('div.view-head', {}, h('div', {}, h('h2', {}, 'Insights & charts'), h('p', {}, `Charts for "${sheet.name}", calculated from your saved data.`)),
      h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, on ? h('button.btn', { type: 'button', onclick: () => window.print() }, h('span', { html: icon('print') }), ' Print / save as PDF') : null)));

    if (!on) {
      root.append(h('div.card.insight-hero', {}, h('div', {},
        h('h3', {}, 'Turn on Insights to see your data come alive'),
        h('p', {}, 'We will look at every column and suggest only the charts that make sense. Hover for exact values, or click “Explain this chart” for a plain-language reading.')), sw));
      root.append(h('div.grid.grid-3', {}, ...[['chart', 'Smart suggestions', 'Bar, line, pie, histogram, scatter and more, chosen from your column types.'], ['bulb', 'Explained in plain words', 'Every chart can tell you what it shows and what it means, using your real numbers.'], ['shield', 'Honest by design', 'If a chart would mislead or the data is missing, we say so instead of drawing it.']].map(([ic, t, d]) => h('div.card.card-pad.feature', {}, h('div.f-ic', { html: icon(ic) }), h('h3', {}, t), h('p', {}, d)))));
      return;
    }

    root.append(h('div.card.insight-hero', {}, h('div', {}, h('h3', {}, 'Insights are on'), h('p', {}, 'Charts refresh automatically whenever you save changes. Unsaved edits are not included.')), sw));
    const body = h('div', {}, h('div.kpi-grid', {}, ...[1, 2, 3, 4].map(() => h('div.card.kpi.skeleton', { style: 'height:96px' }))));
    root.append(body);

    let data;
    try {
      if (ctx.hasUnsaved()) body.before(h('div.notice.warn', { style: 'margin-bottom:16px' }, h('span', { html: icon('alert') }), h('span', {}, 'You have unsaved changes. Charts show your last saved data. Save to include your edits.')));
      data = await ctx.api.get(`/api/workbooks/${ctx.id()}/sheets/${sheet.id}/insights`);
    } catch (e) { body.replaceChildren(h('div.notice.danger', {}, h('span', { html: icon('alert') }), h('span', {}, e.message))); return; }
    if (ctx.currentTab() !== 'insights' || ctx.sheet().id !== sheet.id) return;
    renderInsights(ctx, body, data);
  }

  function renderInsights(ctx, body, data) {
    disposeAll();
    const sheet = ctx.sheet();
    const rebuild = () => ctx.api.get(`/api/workbooks/${ctx.id()}/sheets/${sheet.id}/insights`).then((d) => renderInsights(ctx, body, d)).catch((e) => ctx.toast('err', 'Could not refresh charts', e.message));

    const kp = h('div.kpi-grid', {}, data.kpis.map((k) => h('div.card.kpi', {}, h('div.kl', {}, k.label), h('div.kv', {}, k.value), h('div.kh', {}, k.hint))));
    const q = data.quality;
    const qCard = q.score === null ? null : h('div.card.kpi', {}, h('div.kl', {}, 'Data quality'), h('div.kv', {}, `${q.score}/100 `, h('span.badge.' + (q.score >= 75 ? 'ok' : q.score >= 50 ? 'warn' : 'danger'), {}, q.label)), h('div.kh', {}, `${q.blankCells} blank cell(s)${q.dupRows ? ` · ${q.dupRows} duplicate row(s)` : ''}`));
    if (qCard) kp.append(qCard);

    const autos = h('div.chart-grid');
    data.charts.forEach((c, i) => autos.append(chartCard(c, ctx, { wide: i === 0 && c.ok && ['line', 'area', 'bar', 'hbar'].includes(c.type) && c.categories && c.categories.length > 8 })));

    const savedHost = h('div.chart-grid');
    const onDelete = async (c) => {
      if (!(await window.S2A.confirmDialog({ title: 'Delete this chart?', body: `“${c.title}” will be removed from this sheet.`, danger: true, confirmText: 'Delete chart' }))) return;
      try { await ctx.api.del(`/api/workbooks/${ctx.id()}/sheets/${sheet.id}/charts/${encodeURIComponent(c.id)}`); ctx.toast('ok', 'Chart deleted'); rebuild(); } catch (e) { ctx.toast('err', 'Could not delete', e.message); }
    };
    const builderHost = h('div');
    const onEdit = (c) => { openBuilder(ctx, builderHost, data, c.config, c.id, rebuild); builderHost.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
    data.saved.forEach((c) => savedHost.append(chartCard(c, ctx, { saved: true, onEdit, onDelete })));

    const skipped = data.skipped.length ? h('div.card.card-pad', { style: 'margin-top:22px' }, h('h3', {}, 'Charts we deliberately did not create'), h('p.small.muted', {}, 'Drawing a chart just to fill space can mislead, so we only show the ones the data supports.'), h('ul.skipped.small.muted', {}, data.skipped.map((s) => h('li', {}, h('b', {}, s.title + ': '), s.reason)))) : null;

    body.replaceChildren(
      kp,
      data.charts.length ? h('div.section-title', {}, h('h3', {}, 'Suggested for this sheet'), h('span.xs.muted', {}, `${data.charts.length} chart${data.charts.length === 1 ? '' : 's'}`)) : null,
      data.charts.length ? autos : h('div.card', {}, h('div.empty', {}, h('div.em-ic', { html: icon('chart') }), h('h3', {}, 'No suggested charts yet'), h('p', {}, 'This sheet needs a few more records, or a column with repeated categories, numbers or dates. You can still build your own below.'))),
      data.lockedAutoCharts ? h('div.notice', { style: 'margin-top:16px' }, h('span', { html: icon('lock') }), h('span', {}, `${data.lockedAutoCharts} more suggested chart(s) are available on a higher plan. `, h('a', { href: '/pricing' }, 'See plans'))) : null,
      h('div.section-title', {}, h('h3', {}, 'Your charts'), h('button.btn.btn-primary', { type: 'button', onclick: () => { openBuilder(ctx, builderHost, data, null, null, rebuild); builderHost.scrollIntoView({ behavior: 'smooth', block: 'center' }); } }, h('span', { html: icon('plus') }), ' Build a chart')),
      data.saved.length ? savedHost : h('p.muted.small', {}, 'Build your own chart to choose the type, columns, calculation, filters and date range. Saved charts update automatically.'),
      builderHost, skipped);
  }

  // ------------------------------------------------------------------ builder

  const NEEDS = {
    bar: ['dimension'], hbar: ['dimension'], pie: ['dimension'], doughnut: ['dimension'], stacked: ['dimension', 'series'],
    line: ['dimension'], area: ['dimension'], histogram: ['measure'], scatter: ['xMeasure', 'yMeasure'], box: ['measure'],
  };
  const TYPE_HELP = {
    bar: 'Compare groups side by side.', hbar: 'Like a bar chart, easier for long names.', line: 'Show change over time.', area: 'Like a line, with the area filled.',
    pie: 'Show shares of a whole (few groups).', doughnut: 'A pie chart with a hole in the middle.', stacked: 'Compare groups and see what they are made of.',
    histogram: 'See how a number is spread out.', scatter: 'See if two numbers move together.', box: 'Compare the spread of a number across groups.',
  };

  function openBuilder(ctx, host, data, existing, chartId, onDone) {
    const sheet = ctx.sheet();
    const opts = data.options;
    const st = existing ? JSON.parse(JSON.stringify(existing)) : { type: 'bar', agg: 'count', sort: 'desc', filters: [] };
    st.filters = st.filters || [];
    const allCols = sheet.columns.map((c) => ({ id: c.id, label: c.label }));
    const previewHost = h('div.builder-preview');
    let timer;

    const sel = (key, label, list, { blank, hint } = {}) => {
      const s = h('select.select', { id: 'b-' + key, onchange: (e) => { st[key] = e.target.value || undefined; changed(); } },
        blank ? h('option', { value: '' }, blank) : h('option', { value: '', disabled: true, selected: !st[key] || null }, 'Choose…'),
        list.map((o) => h('option', { value: o.id, selected: st[key] === o.id || null }, o.label)));
      return h('div', {}, h('label.lbl', { for: 'b-' + key }, label), s, hint ? h('div.help', {}, hint) : null);
    };

    function form() {
      const need = NEEDS[st.type] || [];
      const isGroup = ['bar', 'hbar', 'pie', 'doughnut', 'stacked', 'line', 'area'].includes(st.type);
      const aggs = ['pie', 'doughnut', 'stacked'].includes(st.type) ? ['count', 'sum'] : opts.aggs;
      const aggNeedsMeasure = isGroup && st.agg !== 'count';
      const dimList = ['line', 'area'].includes(st.type) ? opts.dates : st.type === 'box' ? opts.categories : [...opts.categories, ...opts.dates];
      const grid = h('div.builder-grid', {},
        h('div', {}, h('label.lbl', { for: 'b-type' }, 'Chart type'), h('select.select', { id: 'b-type', onchange: (e) => { st.type = e.target.value; if (['pie', 'doughnut', 'stacked'].includes(st.type) && !['count', 'sum'].includes(st.agg)) st.agg = 'count'; changed(true); } }, opts.types.map((t) => h('option', { value: t.id, selected: st.type === t.id || null }, t.label))), h('div.help', {}, TYPE_HELP[st.type])),
        need.includes('dimension') || st.type === 'box' ? sel('dimension', st.type === 'box' ? 'Group by (optional)' : ['line', 'area'].includes(st.type) ? 'Date column' : 'Group by', dimList, st.type === 'box' ? { blank: 'All together' } : {}) : null,
        need.includes('series') ? sel('series', 'Split each bar by', opts.categories) : null,
        need.includes('xMeasure') ? sel('xMeasure', 'Horizontal axis (number)', opts.numbers) : null,
        need.includes('yMeasure') ? sel('yMeasure', 'Vertical axis (number)', opts.numbers) : null,
        (need.includes('measure') && !isGroup) ? sel('measure', st.type === 'histogram' ? 'Number to group' : 'Number to compare', opts.numbers) : null,
        isGroup ? h('div', {}, h('label.lbl', { for: 'b-agg' }, 'Calculate'), h('select.select', { id: 'b-agg', onchange: (e) => { st.agg = e.target.value; changed(true); } }, aggs.map((a) => h('option', { value: a, selected: st.agg === a || null }, { count: 'Count of records', sum: 'Total (sum)', avg: 'Average', min: 'Lowest', max: 'Highest' }[a])))) : null,
        aggNeedsMeasure ? sel('measure', 'Of this number', opts.numbers) : null,
        ['bar', 'hbar', 'pie', 'doughnut'].includes(st.type) ? h('div', {}, h('label.lbl', { for: 'b-sort' }, 'Sort'), h('select.select', { id: 'b-sort', onchange: (e) => { st.sort = e.target.value; changed(); } }, [['desc', 'Biggest first'], ['asc', 'Smallest first'], ['label', 'A to Z']].map(([v, t]) => h('option', { value: v, selected: st.sort === v || null }, t)))) : null,
        ['line', 'area'].includes(st.type) ? h('div', {}, h('label.lbl', { for: 'b-tu' }, 'Group dates by'), h('select.select', { id: 'b-tu', onchange: (e) => { st.timeUnit = e.target.value; changed(); } }, [['auto', 'Automatic'], ['day', 'Day'], ['month', 'Month'], ['year', 'Year']].map(([v, t]) => h('option', { value: v, selected: (st.timeUnit || 'auto') === v || null }, t)))) : null,
        st.type === 'histogram' ? h('div', {}, h('label.lbl', { for: 'b-bins' }, 'Number of ranges'), h('input.input', { id: 'b-bins', type: 'number', min: 3, max: 40, placeholder: 'Automatic', value: st.bins || '', oninput: (e) => { st.bins = e.target.value ? Number(e.target.value) : undefined; changed(); } })) : null,
        ['bar', 'hbar', 'pie', 'doughnut', 'stacked'].includes(st.type) ? h('div', {}, h('label.lbl', { for: 'b-lim' }, 'Show top'), h('input.input', { id: 'b-lim', type: 'number', min: 2, max: 60, placeholder: 'Automatic', value: st.limit || '', oninput: (e) => { st.limit = e.target.value ? Number(e.target.value) : undefined; changed(); } })) : null,
        h('div', { style: 'grid-column:1/-1' }, h('label.lbl', { for: 'b-title' }, 'Chart title (optional)'), h('input.input', { id: 'b-title', maxlength: 100, placeholder: 'Leave empty for an automatic title', value: st.title || '', oninput: (e) => { st.title = e.target.value || undefined; changed(); } })));

      // filters + date range
      const filterRows = st.filters.map((f, i) => h('div.filter-row', {},
        h('select.select', { 'aria-label': 'Filter column', onchange: (e) => { f.col = e.target.value; changed(); } }, allCols.map((c) => h('option', { value: c.id, selected: f.col === c.id || null }, c.label))),
        h('select.select', { 'aria-label': 'Filter condition', onchange: (e) => { f.op = e.target.value; changed(); } }, [['eq', 'is'], ['neq', 'is not'], ['contains', 'contains'], ['gte', 'at least'], ['lte', 'at most']].map(([v, t]) => h('option', { value: v, selected: f.op === v || null }, t))),
        h('input.input', { 'aria-label': 'Filter value', value: f.value || '', oninput: (e) => { f.value = e.target.value; changed(); } }),
        h('button.btn.btn-ghost.btn-icon', { type: 'button', 'aria-label': 'Remove filter', onclick: () => { st.filters.splice(i, 1); changed(true); } }, h('span', { html: icon('x') }))));
      const dateRange = opts.dates.length ? h('div.builder-grid', { style: 'margin:0' },
        sel('dateCol', 'Date range column', opts.dates, { blank: 'No date range' }),
        h('div', {}, h('label.lbl', { for: 'b-from' }, 'From'), h('input.input', { id: 'b-from', type: 'date', value: st.dateFrom || '', oninput: (e) => { st.dateFrom = e.target.value || undefined; if (!st.dateCol && e.target.value) st.dateCol = opts.dates[0].id; changed(true); } })),
        h('div', {}, h('label.lbl', { for: 'b-to' }, 'To'), h('input.input', { id: 'b-to', type: 'date', value: st.dateTo || '', oninput: (e) => { st.dateTo = e.target.value || undefined; if (!st.dateCol && e.target.value) st.dateCol = opts.dates[0].id; changed(true); } }))) : null;

      const actions = h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;margin-top:12px' },
        h('button.btn.btn-primary', { type: 'button', onclick: save }, h('span', { html: icon('check') }), chartId ? ' Update chart' : ' Save chart'),
        h('button.btn', { type: 'button', onclick: () => host.replaceChildren() }, 'Close'),
        h('div.small.muted', { style: 'align-self:center' }, `You can save up to ${data.limits.customCharts} charts per sheet.`));

      host.replaceChildren(h('section.card.builder', { 'aria-label': 'Chart builder' },
        h('h3', {}, chartId ? 'Customise chart' : 'Build your own chart'), h('p.small.muted', {}, 'Pick what to show. A live preview appears below as soon as the choices make sense.'),
        grid,
        h('h4', { style: 'margin:14px 0 8px;font-size:.9rem' }, 'Filters (optional)'), ...filterRows,
        h('button.btn.btn-sm', { type: 'button', onclick: () => { st.filters.push({ col: allCols[0].id, op: 'eq', value: '' }); changed(true); }, disabled: st.filters.length >= 5 || null }, h('span', { html: icon('plus') }), ' Add filter'),
        dateRange ? h('h4', { style: 'margin:14px 0 8px;font-size:.9rem' }, 'Date range (optional)') : null, dateRange,
        actions, previewHost));
    }

    function changed(rebuildForm) {
      if (rebuildForm) { const y = window.scrollY; form(); window.scrollTo(0, y); }
      clearTimeout(timer);
      timer = setTimeout(preview, 350);
    }

    async function preview() {
      const cfg = clean();
      previewHost.replaceChildren(h('div.skeleton', { style: 'height:120px;margin-top:16px' }));
      try {
        const r = await ctx.api.post(`/api/workbooks/${ctx.id()}/sheets/${sheet.id}/charts/preview`, cfg);
        disposeAllPreview();
        previewHost.replaceChildren(h('div', { style: 'margin-top:16px' }, chartCard({ ...r.chart, id: 'preview' }, ctx, {})));
      } catch (e) { previewHost.replaceChildren(h('div.notice', { style: 'margin-top:16px' }, h('span', { html: icon('info') }), h('span', {}, e.message))); }
    }
    function disposeAllPreview() { /* old preview charts are disposed when the node is replaced by resize cleanup */ live.forEach((c) => { if (!c.getDom().isConnected) { try { c.dispose(); } catch { /* ok */ } live.delete(c); } }); }

    function clean() {
      const o = JSON.parse(JSON.stringify(st));
      delete o.id;
      if (!o.dateCol) { delete o.dateFrom; delete o.dateTo; }
      o.filters = (o.filters || []).filter((f) => f.col && String(f.value ?? '') !== '');
      return o;
    }

    async function save() {
      try {
        await ctx.api.post(`/api/workbooks/${ctx.id()}/sheets/${sheet.id}/charts`, { config: clean(), chartId });
        ctx.toast('ok', chartId ? 'Chart updated' : 'Chart saved', 'It will update automatically when your data changes.');
        host.replaceChildren();
        onDone();
      } catch (e) {
        if (e.code === 'PLAN_LIMIT') ctx.upgradeNotice(e); else ctx.toast('err', 'Could not save chart', e.message);
      }
    }

    form();
    if (existing) preview();
  }

  window.S2A.insights = { insightsView, disposeAll };
})();
