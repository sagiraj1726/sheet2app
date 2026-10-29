'use strict';

/**
 * Chart + insight engine.
 *
 * Everything here is deterministic JavaScript over the saved records. No AI, no network.
 * Explanations are assembled ONLY from numbers computed in this file. We never claim causation.
 */
const config = require('../config');
const { AppError } = require('../middleware/errors');
const { fmtNum, median, quantile, storedToDate, isStoredDate, isStoredDateTime } = require('./util');
const schema = require('./schema.service');

const CHART_TYPES = ['bar', 'hbar', 'line', 'area', 'pie', 'doughnut', 'stacked', 'histogram', 'scatter', 'box'];
const AGGS = ['count', 'sum', 'avg', 'min', 'max'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TYPE_NAME = {
  bar: 'bar chart', hbar: 'horizontal bar chart', line: 'line chart', area: 'area chart', pie: 'pie chart',
  doughnut: 'doughnut chart', stacked: 'stacked bar chart', histogram: 'histogram', scatter: 'scatter plot', box: 'box plot',
};
const CHART_LABEL = {
  bar: 'Bar chart', hbar: 'Horizontal bar', line: 'Line chart', area: 'Area chart', pie: 'Pie chart', doughnut: 'Doughnut chart',
  stacked: 'Stacked bar', histogram: 'Histogram', scatter: 'Scatter plot', box: 'Box plot',
};
const ADDITIVE = new Set(['count', 'sum']);
const MAX_CATEGORIES = 60;
const SCATTER_MAX_POINTS = 2000;

// ------------------------------------------------------------------ column classification

function numOf(col, v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (schema.NUMERIC_TYPES.has(col.type)) return schema.toNumber(v);
  return null;
}

function isDateVal(v) {
  return typeof v === 'string' && (isStoredDate(v) || isStoredDateTime(v));
}

/** 'number' | 'date' | 'category' | 'other' */
function kindOf(col, rows) {
  if (col.type === 'readonly' || col.type === 'text' || col.type === 'textarea') {
    const vals = [];
    for (const r of rows) { const v = r.v[col.id]; if (v !== null && v !== undefined) vals.push(v); }
    if (vals.length >= 3) {
      if (col.type === 'readonly' && vals.filter((v) => typeof v === 'number').length / vals.length >= 0.8) return 'number';
      if (col.type === 'readonly' && vals.every(isDateVal)) return 'date';
    }
    if (col.type === 'text') {
      const uniq = new Set(vals.map(String));
      if (vals.length >= 3 && uniq.size <= 30 && uniq.size / vals.length <= 0.5 && col.chartable) return 'category';
    }
    return 'other';
  }
  if (schema.NUMERIC_TYPES.has(col.type)) return 'number';
  if (col.type === 'date' || col.type === 'datetime') return 'date';
  if (['boolean', 'dropdown', 'searchable'].includes(col.type)) return 'category';
  return 'other';
}

function classify(sheet) {
  const out = { number: [], date: [], category: [], other: [] };
  for (const c of sheet.columns) {
    if (!c.chartable) { out.other.push(c); continue; }
    out[kindOf(c, sheet.rows)].push(c);
  }
  return out;
}

const colById = (sheet, id) => sheet.columns.find((c) => c.id === id);

// ------------------------------------------------------------------ formatting

function valueFormat(col) {
  if (!col) return { prefix: '', decimals: undefined };
  return { prefix: col.type === 'currency' ? config.currency : '', decimals: undefined };
}

function fmt(n, col, { decimals } = {}) {
  if (n === null || n === undefined || Number.isNaN(n)) return '–';
  const f = valueFormat(col);
  const s = fmtNum(n, { decimals: decimals ?? (Math.abs(n) >= 100 ? 0 : undefined) });
  return `${f.prefix}${s}`;
}

function monthLabel(key) {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(key);
  if (!m) return key;
  if (m[3]) return `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}`;
  return `${MONTHS[+m[2] - 1]} ${m[1]}`;
}

function bucketKey(date, unit) {
  const y = date.getUTCFullYear();
  const mo = String(date.getUTCMonth() + 1).padStart(2, '0');
  if (unit === 'year') return String(y);
  if (unit === 'month') return `${y}-${mo}`;
  return `${y}-${mo}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function bucketLabel(key, unit) {
  return unit === 'year' ? key : monthLabel(key);
}

function pickUnit(dates, requested) {
  if (['day', 'month', 'year'].includes(requested)) return requested;
  if (!dates.length) return 'month';
  let min = Infinity;
  let max = -Infinity;
  for (const d of dates) { const t = d.getTime(); if (t < min) min = t; if (t > max) max = t; }
  const days = (max - min) / 86400000;
  if (days <= 62) return 'day';
  if (days <= 900) return 'month';
  return 'year';
}

const AGG_PHRASE = (agg, m) => ({
  count: 'number of records',
  sum: `total ${m}`,
  avg: `average ${m}`,
  min: `lowest ${m}`,
  max: `highest ${m}`,
}[agg]);

function aggregate(vals, agg) {
  if (!vals.length) return null;
  switch (agg) {
    case 'sum': return vals.reduce((a, b) => a + b, 0);
    case 'avg': return vals.reduce((a, b) => a + b, 0) / vals.length;
    case 'min': return Math.min(...vals);
    case 'max': return Math.max(...vals);
    default: return vals.length;
  }
}

const round = (n) => (n === null ? null : Math.round(n * 1e6) / 1e6);
const pct = (n, d = 1) => `${fmtNum(n, { decimals: d })}%`;

// ------------------------------------------------------------------ config validation

function bad(msg) {
  return new AppError(422, 'BAD_CHART', msg);
}

/** Validate + normalise a chart config against the sheet. Throws a friendly error. */
function normalizeConfig(sheet, raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const type = c.type;
  if (!CHART_TYPES.includes(type)) throw bad('Choose a chart type.');
  const cls = classify(sheet);
  const out = { type, agg: AGGS.includes(c.agg) ? c.agg : 'count', sort: ['desc', 'asc', 'label'].includes(c.sort) ? c.sort : (type === 'line' || type === 'area' ? 'label' : 'desc') };
  const need = (id, label, kinds) => {
    const col = colById(sheet, id);
    if (!col) throw bad(`Choose a column for "${label}".`);
    const k = kindOf(col, sheet.rows);
    if (!kinds.includes(k)) throw bad(`"${col.label}" cannot be used for ${label}. ${label[0].toUpperCase() + label.slice(1)} needs a ${kinds.join(' or ')} column.`);
    return col;
  };

  if (['bar', 'hbar', 'pie', 'doughnut', 'stacked'].includes(type)) {
    out.dimension = need(c.dimension, 'the category', ['category', 'date']).id;
  } else if (type === 'line' || type === 'area') {
    out.dimension = need(c.dimension, 'the time axis', ['date']).id;
  }
  if (type === 'stacked') {
    out.series = need(c.series, 'the stack split', ['category']).id;
    if (out.series === out.dimension) throw bad('The category and the stack split must be different columns.');
    if (!ADDITIVE.has(out.agg)) out.agg = 'count';
  }
  if (type === 'pie' || type === 'doughnut') {
    if (!ADDITIVE.has(out.agg)) throw bad('Pie and doughnut charts show parts of a whole, so they can only use "count" or "sum".');
  }
  if (out.agg !== 'count' && !['histogram', 'scatter', 'box'].includes(type)) {
    out.measure = need(c.measure, 'the number to calculate', ['number']).id;
  } else if (c.measure && !['histogram', 'scatter', 'box'].includes(type)) {
    out.measure = need(c.measure, 'the number to calculate', ['number']).id;
  }
  if (type === 'histogram') out.measure = need(c.measure, 'the numbers to group', ['number']).id;
  if (type === 'box') {
    out.measure = need(c.measure, 'the numbers to compare', ['number']).id;
    if (c.dimension) out.dimension = need(c.dimension, 'the group', ['category']).id;
  }
  if (type === 'scatter') {
    out.xMeasure = need(c.xMeasure, 'the horizontal axis', ['number']).id;
    out.yMeasure = need(c.yMeasure, 'the vertical axis', ['number']).id;
    if (out.xMeasure === out.yMeasure) throw bad('Pick two different number columns to compare.');
  }
  if (['line', 'area'].includes(type) || (c.timeUnit && ['bar', 'hbar'].includes(type))) {
    out.timeUnit = ['auto', 'day', 'month', 'year'].includes(c.timeUnit) ? c.timeUnit : 'auto';
  }
  if (c.limit !== undefined) {
    const n = Math.floor(Number(c.limit));
    if (Number.isFinite(n)) out.limit = Math.max(2, Math.min(MAX_CATEGORIES, n));
  }
  if (c.bins !== undefined) {
    const n = Math.floor(Number(c.bins));
    if (Number.isFinite(n)) out.bins = Math.max(3, Math.min(40, n));
  }
  if (typeof c.title === 'string' && c.title.trim()) out.title = c.title.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 100);

  // filters
  out.filters = [];
  for (const f of Array.isArray(c.filters) ? c.filters.slice(0, 5) : []) {
    if (!f || !f.col) continue;
    const col = colById(sheet, f.col);
    if (!col) throw bad('A filter uses a column that no longer exists.');
    if (!['eq', 'neq', 'gte', 'lte', 'contains'].includes(f.op)) throw bad('Unknown filter type.');
    if (f.value === undefined || f.value === null || f.value === '') continue;
    out.filters.push({ col: col.id, op: f.op, value: String(f.value).slice(0, 100) });
  }
  // date range
  if (c.dateCol) {
    const dc = colById(sheet, c.dateCol);
    if (!dc || kindOf(dc, sheet.rows) !== 'date') throw bad('The date range needs a date column.');
    out.dateCol = dc.id;
    if (c.dateFrom) { if (!isStoredDate(String(c.dateFrom))) throw bad('Start date is not valid.'); out.dateFrom = c.dateFrom; }
    if (c.dateTo) { if (!isStoredDate(String(c.dateTo))) throw bad('End date is not valid.'); out.dateTo = c.dateTo; }
    if (out.dateFrom && out.dateTo && out.dateFrom > out.dateTo) throw bad('The start date must be before the end date.');
  }
  return out;
}

function applyFilters(sheet, cfg) {
  let rows = sheet.rows;
  for (const f of cfg.filters || []) {
    const col = colById(sheet, f.col);
    const num = schema.NUMERIC_TYPES.has(col.type) ? Number(f.value) : NaN;
    rows = rows.filter((r) => {
      const v = r.v[f.col];
      if (v === null || v === undefined) return false;
      if (f.op === 'eq') return String(v) === f.value;
      if (f.op === 'neq') return String(v) !== f.value;
      if (f.op === 'contains') return String(v).toLowerCase().includes(f.value.toLowerCase());
      const cmp = Number.isFinite(num) ? Number(v) : String(v);
      const target = Number.isFinite(num) ? num : f.value;
      return f.op === 'gte' ? cmp >= target : cmp <= target;
    });
  }
  if (cfg.dateCol && (cfg.dateFrom || cfg.dateTo)) {
    rows = rows.filter((r) => {
      const v = r.v[cfg.dateCol];
      if (!isDateVal(v)) return false;
      const d = v.slice(0, 10);
      return (!cfg.dateFrom || d >= cfg.dateFrom) && (!cfg.dateTo || d <= cfg.dateTo);
    });
  }
  return rows;
}

// ------------------------------------------------------------------ explanation helpers

const comparisonWords = (a, b) => (b > a ? 'rose' : b < a ? 'fell' : 'stayed the same');

function changeSentence(measureText, startLabel, endLabel, a, b, col) {
  if (a === b) return `${measureText} stayed at ${fmt(a, col)} from ${startLabel} to ${endLabel}.`;
  const diff = b - a;
  const dir = diff > 0 ? 'increased' : 'decreased';
  const word = diff > 0 ? 'a rise' : 'a drop';
  const absTxt = fmt(Math.abs(diff), col);
  if (a === 0) return `${measureText} ${dir} from ${fmt(a, col)} in ${startLabel} to ${fmt(b, col)} in ${endLabel}, ${word} of ${absTxt} (a percentage cannot be calculated from zero).`;
  const p = (Math.abs(diff) / Math.abs(a)) * 100;
  return `${measureText} ${dir} from ${fmt(a, col)} in ${startLabel} to ${fmt(b, col)} in ${endLabel}, ${word} of ${absTxt} or ${pct(p)}.`;
}

function capFirst(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function baseResult(cfg, title, extra) {
  return { id: cfg.id, type: cfg.type, typeLabel: CHART_LABEL[cfg.type], title, config: cfg, ok: true, warnings: [], ...extra };
}

function unavailable(cfg, title, reason) {
  return { id: cfg.id, type: cfg.type, typeLabel: CHART_LABEL[cfg.type], title, config: cfg, ok: false, reason };
}

// ------------------------------------------------------------------ chart builders

function sortGroups(groups, sort, isTime) {
  const arr = [...groups];
  if (isTime) return arr.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  if (sort === 'label') arr.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  else if (sort === 'asc') arr.sort((a, b) => a.value - b.value);
  else arr.sort((a, b) => b.value - a.value);
  return arr;
}

function buildGrouped(sheet, rows, cfg, title) {
  const dim = colById(sheet, cfg.dimension);
  const measure = cfg.measure ? colById(sheet, cfg.measure) : null;
  const agg = cfg.agg;
  const dimKind = kindOf(dim, sheet.rows);
  const isTime = dimKind === 'date';
  const warnings = [];
  const limitations = [];

  const dates = [];
  if (isTime) for (const r of rows) { const d = storedToDate(r.v[dim.id]); if (d) dates.push(d); }
  const unit = isTime ? pickUnit(dates, cfg.timeUnit) : null;

  const buckets = new Map();
  let blankDim = 0;
  let blankMeasure = 0;
  let used = 0;
  for (const r of rows) {
    const dv = r.v[dim.id];
    if (dv === null || dv === undefined || dv === '') { blankDim += 1; continue; }
    let key;
    let label;
    if (isTime) {
      const d = storedToDate(dv);
      if (!d) { blankDim += 1; continue; }
      key = bucketKey(d, unit);
      label = bucketLabel(key, unit);
    } else { key = String(dv); label = key; }
    let slot = buckets.get(key);
    if (!slot) { slot = { key, label, vals: [], n: 0 }; buckets.set(key, slot); }
    if (agg === 'count') { slot.n += 1; used += 1; continue; }
    const n = numOf(measure, r.v[measure.id]);
    if (n === null) { blankMeasure += 1; continue; }
    slot.vals.push(n);
    slot.n += 1;
    used += 1;
  }

  let groups = [...buckets.values()]
    .filter((g) => g.n > 0)
    .map((g) => ({ key: g.key, label: g.label, n: g.n, value: round(agg === 'count' ? g.n : aggregate(g.vals, agg)) }));
  if (!groups.length) return unavailable(cfg, title, 'There is no usable data for this combination yet (every matching record has a blank value).');
  if (groups.length > MAX_CATEGORIES && !isTime && cfg.type !== 'bar' && cfg.type !== 'hbar') {
    return unavailable(cfg, title, `"${dim.label}" has ${groups.length} different values, which is too many to read on this chart. Try a bar chart with a top-N limit.`);
  }
  if (groups.length === 1 && cfg.type !== 'pie' && cfg.type !== 'doughnut') {
    return unavailable(cfg, title, `All records share one value for "${dim.label}", so there is nothing to compare.`);
  }

  groups = sortGroups(groups, cfg.sort, isTime);
  const total = ADDITIVE.has(agg) ? groups.reduce((a, g) => a + g.value, 0) : null;
  const defaultLimit = cfg.type === 'pie' || cfg.type === 'doughnut' ? 8 : 15;
  const limit = isTime ? 400 : cfg.limit || defaultLimit;
  let shown = groups;
  let otherNote = null;
  if (!isTime && groups.length > limit) {
    const top = groups.slice(0, limit - 1 > 0 ? limit : 1);
    const rest = groups.slice(top.length);
    if (ADDITIVE.has(agg) && cfg.sort !== 'label' && (cfg.type === 'pie' || cfg.type === 'doughnut')) {
      const otherVal = rest.reduce((a, g) => a + g.value, 0);
      shown = [...top.slice(0, limit - 1), { key: '__other', label: `Other (${rest.length + 1})`, value: round(otherVal + (top[limit - 1] ? top[limit - 1].value : 0)), n: 0 }];
      otherNote = `Smaller groups are combined into "Other".`;
    } else {
      shown = top;
      otherNote = `Showing the top ${top.length} of ${groups.length} groups.`;
    }
  }
  if (otherNote) limitations.push(otherNote);

  const mText = measure ? measure.label.toLowerCase() : 'records';
  const aggText = AGG_PHRASE(agg, mText);
  const vcol = measure;
  const dimLabel = dim.label;

  if (blankDim) limitations.push(`${blankDim} record(s) have no "${dimLabel}" so they are not shown.`);
  if (blankMeasure) limitations.push(`${blankMeasure} record(s) have no "${measure.label}" so they are left out of the ${agg === 'avg' ? 'average' : 'result'}.`);
  if (agg === 'avg' && !isTime) limitations.push('Averages hide how many records are behind each bar. Small groups can look extreme.');
  const filtered = (cfg.filters && cfg.filters.length) || cfg.dateFrom || cfg.dateTo;
  if (filtered) limitations.push(`Filters are applied, so this covers ${rows.length} of ${sheet.rows.length} records.`);

  const isPie = cfg.type === 'pie' || cfg.type === 'doughnut';
  const typeName = TYPE_NAME[cfg.type];

  // ---- explanation
  const what = isTime
    ? `This ${typeName} shows the ${aggText} for each ${unit} based on "${dimLabel}".`
    : `This ${typeName} shows the ${aggText} for each "${dimLabel}".`;
  let howToRead;
  if (isPie) howToRead = `The whole circle is 100%. Each slice is one "${dimLabel}" value; a bigger slice means a bigger share of the ${aggText}. Hover a slice to see the exact value and percentage.`;
  else if (cfg.type === 'hbar') howToRead = `Each horizontal bar is one "${dimLabel}" value. The longer the bar, the higher the ${aggText}. Hover a bar for the exact figure.`;
  else if (isTime) howToRead = `Left to right is time (${unit === 'day' ? 'days' : unit === 'month' ? 'months' : 'years'}). The height of the ${cfg.type === 'area' ? 'shaded area' : 'line'} shows the ${aggText}. Going up means more; going down means less.`;
  else howToRead = `Each bar is one "${dimLabel}" value. The taller the bar, the higher the ${aggText}. Hover a bar for the exact figure.`;

  let pattern = '';
  let meaning = '';
  const first = shown[0];
  if (isTime && shown.length >= 2) {
    const a = shown[0];
    const z = shown[shown.length - 1];
    const peak = shown.reduce((m, g) => (g.value > m.value ? g : m), shown[0]);
    const low = shown.reduce((m, g) => (g.value < m.value ? g : m), shown[0]);
    pattern = `${capFirst(aggText)} ${comparisonWords(a.value, z.value)} overall between ${a.label} and ${z.label}. The highest point is ${peak.label} (${fmt(peak.value, vcol)}) and the lowest is ${low.label} (${fmt(low.value, vcol)}).`;
    meaning = changeSentence(capFirst(aggText), a.label, z.label, a.value, z.value, vcol);
    if (shown.length >= 3) {
      const prev = shown[shown.length - 2];
      meaning += ` The most recent step, ${prev.label} to ${z.label}, was ${prev.value === z.value ? 'flat' : z.value > prev.value ? `up ${fmt(z.value - prev.value, vcol)}` : `down ${fmt(prev.value - z.value, vcol)}`}.`;
    }
    if (peak.label !== z.label && peak.value !== z.value) meaning += ` ${peak.label} was the strongest period. It could be worth checking what was different then.`;
    if (shown.length < 4) limitations.push('There are only a few time points, so this is not enough to call a trend.');
    const gaps = missingPeriods(shown, unit);
    if (gaps > 0) limitations.push(`${gaps} ${unit}(s) between the first and last point have no records and are not drawn as zero.`);
  } else if (shown.length >= 1) {
    const sorted = [...shown].sort((p, q) => q.value - p.value);
    const hi = sorted[0];
    const lo = sorted[sorted.length - 1];
    if (ADDITIVE.has(agg) && total > 0) {
      const share = (hi.value / total) * 100;
      pattern = `"${hi.label}" is the largest with ${fmt(hi.value, vcol)} (${pct(share)} of the total ${fmt(total, vcol)}).`;
      if (sorted.length > 1) pattern += ` The smallest is "${lo.label}" with ${fmt(lo.value, vcol)}.`;
      const topN = Math.min(3, sorted.length);
      if (sorted.length > 3) {
        const topShare = (sorted.slice(0, topN).reduce((a, g) => a + g.value, 0) / total) * 100;
        meaning = `The top ${topN} groups together make up ${pct(topShare)} of the total. `;
      }
      if (sorted.length > 1 && sorted[1].value > 0) {
        const ratio = hi.value / sorted[1].value;
        meaning += `"${hi.label}" is ${ratio >= 1.05 ? `${fmtNum(ratio, { decimals: 1 })} times` : 'about the same as'} "${sorted[1].label}", the second largest.`;
      }
    } else {
      pattern = `"${hi.label}" has the highest ${aggText} at ${fmt(hi.value, vcol)}. `;
      if (sorted.length > 1) pattern += `"${lo.label}" has the lowest at ${fmt(lo.value, vcol)}.`;
      if (sorted.length > 1 && lo.value !== 0) {
        const diff = hi.value - lo.value;
        meaning = `The gap between the highest and lowest group is ${fmt(diff, vcol)}${lo.value > 0 ? `, which is ${pct((diff / lo.value) * 100, 0)} more than the lowest` : ''}.`;
      }
    }
    if (first && shown.length === 1) meaning = 'Only one group is shown, so there is nothing to compare yet.';
  }
  meaning = (meaning.trim() ? meaning.trim() + ' ' : '') + 'These figures describe what is in your sheet; they do not explain why the differences exist.';

  const series = [{ name: capFirst(aggText), data: shown.map((g) => g.value) }];
  return baseResult(cfg, title, {
    kind: isPie ? 'pie' : 'cartesian',
    categories: shown.map((g) => g.label),
    series,
    counts: shown.map((g) => g.n),
    total: ADDITIVE.has(agg) ? round(total) : null,
    axis: { x: isTime ? `${dimLabel} (by ${unit})` : dimLabel, y: capFirst(aggText) },
    format: valueFormat(vcol),
    explain: { what, howToRead, pattern, limitations },
    meaning,
    usedRecords: used,
  });
}

function missingPeriods(groups, unit) {
  if (groups.length < 2 || unit === 'day') return 0;
  const idx = (k) => (unit === 'year' ? +k : +k.slice(0, 4) * 12 + +k.slice(5, 7));
  const span = idx(groups[groups.length - 1].key) - idx(groups[0].key) + 1;
  return Math.max(0, span - groups.length);
}

function buildStacked(sheet, rows, cfg, title) {
  const dim = colById(sheet, cfg.dimension);
  const ser = colById(sheet, cfg.series);
  const measure = cfg.measure ? colById(sheet, cfg.measure) : null;
  const dimKind = kindOf(dim, sheet.rows);
  const dates = dimKind === 'date' ? rows.map((r) => storedToDate(r.v[dim.id])).filter(Boolean) : [];
  const unit = dimKind === 'date' ? pickUnit(dates, cfg.timeUnit) : null;
  const cell = new Map();
  const catTotals = new Map();
  const serTotals = new Map();
  let used = 0;
  for (const r of rows) {
    const dv = r.v[dim.id];
    const sv = r.v[ser.id];
    if (dv == null || sv == null || dv === '' || sv === '') continue;
    let ck;
    if (unit) { const d = storedToDate(dv); if (!d) continue; ck = bucketKey(d, unit); } else ck = String(dv);
    const sk = String(sv);
    let val = 1;
    if (cfg.agg === 'sum') { val = numOf(measure, r.v[measure.id]); if (val === null) continue; }
    cell.set(`${ck}\u0000${sk}`, (cell.get(`${ck}\u0000${sk}`) || 0) + val);
    catTotals.set(ck, (catTotals.get(ck) || 0) + val);
    serTotals.set(sk, (serTotals.get(sk) || 0) + val);
    used += 1;
  }
  if (!used) return unavailable(cfg, title, 'There is no usable data for this combination yet.');
  let cats = [...catTotals.keys()];
  cats = unit ? cats.sort() : cats.sort((a, b) => catTotals.get(b) - catTotals.get(a));
  const limit = cfg.limit || 12;
  const limitations = [];
  if (cats.length > limit) { limitations.push(`Showing the top ${limit} of ${cats.length} groups.`); cats = cats.slice(0, limit); }
  const sers = [...serTotals.keys()].sort((a, b) => serTotals.get(b) - serTotals.get(a));
  if (sers.length > 10) return unavailable(cfg, title, `"${ser.label}" has ${sers.length} different values, which is too many colours to read. Pick a column with 10 or fewer values.`);
  if (cats.length < 2) return unavailable(cfg, title, 'There is only one group on the main axis, so a stacked comparison would not tell you anything.');
  const agText = cfg.agg === 'sum' ? `total ${measure.label.toLowerCase()}` : 'number of records';
  const topCat = cats.reduce((m, c) => (catTotals.get(c) > catTotals.get(m) ? c : m), cats[0]);
  const topSer = sers[0];
  const grand = [...catTotals.values()].reduce((a, b) => a + b, 0);
  limitations.push('Stacked bars compare the totals well, but the segments in the middle are harder to compare exactly. Use hover for exact values.');
  return baseResult(cfg, title, {
    kind: 'cartesian',
    stacked: true,
    categories: cats.map((c) => (unit ? bucketLabel(c, unit) : c)),
    series: sers.map((s) => ({ name: s, data: cats.map((c) => round(cell.get(`${c}\u0000${s}`) || 0)) })),
    axis: { x: dim.label, y: capFirst(agText) },
    format: valueFormat(measure),
    explain: {
      what: `This stacked bar chart shows the ${agText} for each "${dim.label}", split into colours by "${ser.label}".`,
      howToRead: 'The full height of a bar is its total. The coloured pieces show how that total is made up. Hover a piece for its exact value.',
      pattern: `"${unit ? bucketLabel(topCat, unit) : topCat}" has the largest total (${fmt(catTotals.get(topCat), measure)}). Across all bars, "${topSer}" is the biggest piece (${pct((serTotals.get(topSer) / grand) * 100)} of everything shown).`,
      limitations,
    },
    meaning: `Overall, "${topSer}" accounts for ${pct((serTotals.get(topSer) / grand) * 100)} of the ${agText}. Seeing two things together does not prove one causes the other.`,
    usedRecords: used,
  });
}

function buildHistogram(sheet, rows, cfg, title) {
  const m = colById(sheet, cfg.measure);
  const vals = [];
  let blank = 0;
  for (const r of rows) { const n = numOf(m, r.v[m.id]); if (n === null) blank += 1; else vals.push(n); }
  if (vals.length < 5) return unavailable(cfg, title, `"${m.label}" has only ${vals.length} usable number(s). A histogram needs at least 5.`);
  const sorted = [...vals].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  if (min === max) return unavailable(cfg, title, `Every value in "${m.label}" is ${fmt(min, m)}, so there is no spread to show.`);
  const allInt = sorted.every(Number.isInteger);
  let bins = cfg.bins || Math.min(20, Math.max(5, Math.ceil(Math.log2(vals.length) + 1)));
  let width = (max - min) / bins;
  if (allInt) { width = Math.max(1, Math.ceil(width)); bins = Math.ceil((max - min + 1) / width); }
  const counts = new Array(bins).fill(0);
  for (const v of vals) counts[Math.min(bins - 1, Math.floor((v - min) / width))] += 1;
  const labels = counts.map((_, i) => {
    const lo = min + i * width;
    const hi = allInt ? lo + width - 1 : lo + width;
    return allInt && width === 1 ? fmtNum(lo) : `${fmtNum(lo, { decimals: 1 })}–${fmtNum(hi, { decimals: 1 })}`;
  });
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const med = median(sorted);
  const modeIdx = counts.indexOf(Math.max(...counts));
  const limitations = [];
  if (blank) limitations.push(`${blank} record(s) have no "${m.label}" and are left out.`);
  if (vals.length < 20) limitations.push('With fewer than 20 values the shape can change a lot when one record changes.');
  const skewNote = Math.abs(mean - med) > (max - min) * 0.1 ? ` The average (${fmt(mean, m)}) and the middle value (${fmt(med, m)}) are noticeably different, which usually means a few unusually ${mean > med ? 'high' : 'low'} values are pulling the average.` : '';
  return baseResult(cfg, title, {
    kind: 'cartesian',
    categories: labels,
    series: [{ name: 'Records', data: counts }],
    axis: { x: m.label, y: 'Number of records' },
    format: { prefix: '', decimals: 0 },
    xFormat: valueFormat(m),
    explain: {
      what: `This histogram groups the values of "${m.label}" into ranges ("buckets") and counts how many records fall into each range.`,
      howToRead: 'Each bar is one range of values on the bottom axis. A taller bar means more records in that range. Hover a bar to see the range and the count.',
      pattern: `Most records (${counts[modeIdx]} of ${vals.length}) fall in the range ${labels[modeIdx]}. Values go from ${fmt(min, m)} to ${fmt(max, m)}.`,
      limitations,
    },
    meaning: `The lowest value is ${fmt(min, m)}, the highest is ${fmt(max, m)}, the average is ${fmt(mean, m)} and the middle value (median) is ${fmt(med, m)}.${skewNote}`,
    usedRecords: vals.length,
  });
}

function pearson(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0; let sxx = 0; let syy = 0;
  for (let i = 0; i < n; i += 1) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

function buildScatter(sheet, rows, cfg, title) {
  const x = colById(sheet, cfg.xMeasure);
  const y = colById(sheet, cfg.yMeasure);
  const pts = [];
  let blank = 0;
  for (const r of rows) {
    const a = numOf(x, r.v[x.id]);
    const b = numOf(y, r.v[y.id]);
    if (a === null || b === null) { blank += 1; continue; }
    pts.push([a, b]);
  }
  if (pts.length < 8) return unavailable(cfg, title, `Only ${pts.length} record(s) have both "${x.label}" and "${y.label}". A scatter plot needs at least 8 to be meaningful.`);
  const r = pearson(pts.map((p) => p[0]), pts.map((p) => p[1]));
  if (r === null) return unavailable(cfg, title, 'One of the two columns has the same value in every record, so there is no relationship to show.');
  const abs = Math.abs(r);
  const strength = abs >= 0.7 ? 'strong' : abs >= 0.4 ? 'moderate' : abs >= 0.2 ? 'weak' : 'very little';
  const dir = r > 0 ? 'rises' : 'falls';
  const limitations = [];
  if (blank) limitations.push(`${blank} record(s) are missing one of the two numbers and are not plotted.`);
  let shown = pts;
  if (pts.length > SCATTER_MAX_POINTS) {
    const step = pts.length / SCATTER_MAX_POINTS;
    shown = Array.from({ length: SCATTER_MAX_POINTS }, (_, i) => pts[Math.floor(i * step)]);
    limitations.push(`Only an evenly spread sample of ${SCATTER_MAX_POINTS} of ${pts.length} points is drawn. The statistics use all points.`);
  }
  limitations.push('A relationship between two columns does not prove that one causes the other.');
  return baseResult(cfg, title, {
    kind: 'scatter',
    points: shown,
    axis: { x: x.label, y: y.label },
    xFormat: valueFormat(x),
    format: valueFormat(y),
    explain: {
      what: `This scatter plot puts each record on the chart as a dot. Left-to-right is "${x.label}" and bottom-to-top is "${y.label}".`,
      howToRead: 'If the dots form a line going up, the two numbers tend to rise together. If the line goes down, one tends to fall as the other rises. A shapeless cloud means no clear link.',
      pattern: abs < 0.2
        ? `The two columns show very little relationship (correlation ${fmtNum(r, { decimals: 2 })}).`
        : `There is a ${strength} relationship: as "${x.label}" goes up, "${y.label}" usually ${dir} (correlation ${fmtNum(r, { decimals: 2 })}).`,
      limitations,
    },
    meaning: `Based on ${pts.length} records, the correlation between "${x.label}" and "${y.label}" is ${fmtNum(r, { decimals: 2 })} (1 is a perfect upward link, −1 a perfect downward link, 0 no link). This tells you the two move together, not why.`,
    usedRecords: pts.length,
  });
}

function boxStats(vals) {
  const s = [...vals].sort((a, b) => a - b);
  const q1 = quantile(s, 0.25);
  const q3 = quantile(s, 0.75);
  const iqr = q3 - q1;
  const loF = q1 - 1.5 * iqr;
  const hiF = q3 + 1.5 * iqr;
  const inside = s.filter((v) => v >= loF && v <= hiF);
  return { min: inside[0], q1, med: median(s), q3, max: inside[inside.length - 1], outliers: s.filter((v) => v < loF || v > hiF), n: s.length };
}

function buildBox(sheet, rows, cfg, title) {
  const m = colById(sheet, cfg.measure);
  const dim = cfg.dimension ? colById(sheet, cfg.dimension) : null;
  const groups = new Map();
  let blank = 0;
  for (const r of rows) {
    const n = numOf(m, r.v[m.id]);
    if (n === null) { blank += 1; continue; }
    let k = m.label;
    if (dim) { const dv = r.v[dim.id]; if (dv == null || dv === '') { blank += 1; continue; } k = String(dv); }
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(n);
  }
  let list = [...groups.entries()].filter(([, v]) => v.length >= 4);
  if (!list.length) return unavailable(cfg, title, `A box plot needs at least 4 values per group. ${dim ? 'No group has enough yet.' : `"${m.label}" has too few values.`}`);
  list.sort((a, b) => b[1].length - a[1].length);
  const limitations = [];
  if (list.length > 12) { list = list.slice(0, 12); limitations.push('Showing the 12 largest groups.'); }
  const dropped = groups.size - list.length;
  if (dropped > 0 && list.length <= 12) limitations.push(`${dropped} group(s) with fewer than 4 values are not shown.`);
  if (blank) limitations.push(`${blank} record(s) are missing a value and are left out.`);
  const stats = list.map(([k, v]) => ({ key: k, ...boxStats(v) }));
  const outliers = [];
  stats.forEach((s, i) => s.outliers.forEach((v) => outliers.push([i, v])));
  const top = [...stats].sort((a, b) => b.med - a.med)[0];
  return baseResult(cfg, title, {
    kind: 'box',
    categories: stats.map((s) => s.key),
    boxes: stats.map((s) => [s.min, s.q1, s.med, s.q3, s.max]),
    counts: stats.map((s) => s.n),
    outliers,
    axis: { x: dim ? dim.label : '', y: m.label },
    format: valueFormat(m),
    explain: {
      what: `This box plot shows how the values of "${m.label}" are spread out${dim ? `, separately for each "${dim.label}"` : ''}.`,
      howToRead: 'The box covers the middle half of the values. The line inside the box is the middle value (median). The thin lines (whiskers) reach the typical lowest and highest values. Dots outside are unusual values.',
      pattern: stats.length > 1
        ? `"${top.key}" has the highest median (${fmt(top.med, m)}). ${stats.length > 1 ? `The lowest median is ${fmt(Math.min(...stats.map((s) => s.med)), m)}.` : ''}`
        : `The middle value is ${fmt(stats[0].med, m)}; the middle half of values lies between ${fmt(stats[0].q1, m)} and ${fmt(stats[0].q3, m)}.`,
      limitations,
    },
    meaning: `${outliers.length ? `${outliers.length} unusual value(s) sit well outside the rest and are shown as dots. They may be genuine or typing mistakes, so they are worth checking. ` : 'No unusually high or low values were found. '}A wider box means the values in that group vary more.`,
    usedRecords: stats.reduce((a, s) => a + s.n, 0),
  });
}

function defaultTitle(sheet, cfg) {
  const L = (id) => (colById(sheet, id) || {}).label || '';
  const a = cfg.agg === 'count' ? 'Records' : `${capFirst(AGG_PHRASE(cfg.agg, L(cfg.measure).toLowerCase()))}`;
  switch (cfg.type) {
    case 'histogram': return `Distribution of ${L(cfg.measure)}`;
    case 'scatter': return `${L(cfg.yMeasure)} vs ${L(cfg.xMeasure)}`;
    case 'box': return cfg.dimension ? `${L(cfg.measure)} spread by ${L(cfg.dimension)}` : `Spread of ${L(cfg.measure)}`;
    case 'stacked': return `${a} by ${L(cfg.dimension)}, split by ${L(cfg.series)}`;
    case 'line': case 'area': return `${a} over time`;
    default: return `${a} by ${L(cfg.dimension)}`;
  }
}

/** Compute one chart. `cfgIn` may be raw (it is validated). Never throws for "unsuitable data" - returns ok:false. */
function computeChart(sheet, cfgIn) {
  const cfg = normalizeConfig(sheet, cfgIn);
  cfg.id = cfgIn.id;
  const title = cfg.title || defaultTitle(sheet, cfg);
  const rows = applyFilters(sheet, cfg);
  if (!rows.length) return unavailable(cfg, title, sheet.rows.length ? 'No records match the current filters.' : 'This sheet has no records yet.');
  let res;
  switch (cfg.type) {
    case 'histogram': res = buildHistogram(sheet, rows, cfg, title); break;
    case 'scatter': res = buildScatter(sheet, rows, cfg, title); break;
    case 'box': res = buildBox(sheet, rows, cfg, title); break;
    case 'stacked': res = buildStacked(sheet, rows, cfg, title); break;
    default: res = buildGrouped(sheet, rows, cfg, title);
  }
  if (res.ok) res.recordsInChart = rows.length;
  return res;
}

// ------------------------------------------------------------------ suggestions + KPIs

function uniqueCount(col, rows) {
  const s = new Set();
  for (const r of rows) { const v = r.v[col.id]; if (v != null && v !== '') s.add(String(v)); }
  return s.size;
}

function suggestCharts(sheet, { maxCharts = 6 } = {}) {
  const rows = sheet.rows;
  const skipped = [];
  const out = [];
  const seen = new Set();
  const add = (cfg) => {
    const sig = JSON.stringify([cfg.type, cfg.dimension, cfg.series, cfg.measure, cfg.xMeasure, cfg.yMeasure, cfg.agg]);
    if (seen.has(sig)) return;
    seen.add(sig);
    out.push({ ...cfg, filters: [] });
  };
  if (sheet.empty || !rows.length) {
    return { configs: [], skipped: [{ title: 'Charts', reason: 'This sheet has no records yet. Add some data and charts will appear.' }], locked: 0 };
  }
  const cls = classify(sheet);
  const cats = cls.category
    .map((c) => ({ c, u: uniqueCount(c, rows) }))
    .filter((x) => x.u >= 2 && x.u <= 40)
    .sort((a, b) => a.u - b.u);
  const nums = cls.number;
  const dates = cls.date.filter((c) => uniqueCount(c, rows) >= 3);

  if (rows.length < 3) skipped.push({ title: 'Charts', reason: `Only ${rows.length} record(s), so most charts would not be meaningful yet.` });
  if (!cats.length) skipped.push({ title: 'Category charts', reason: 'No column has a small set of repeated values (like Status or Department), so bar and pie charts by category were not created.' });
  if (!nums.length) skipped.push({ title: 'Totals, averages & distributions', reason: 'No number columns were found, so sums, averages, histograms and scatter plots were not created.' });
  if (!dates.length) skipped.push({ title: 'Trend over time', reason: 'No date column with enough different dates, so line charts were not created.' });

  if (rows.length >= 3) {
    // 1. Counts by the most useful category
    cats.slice(0, 2).forEach(({ c, u }) => {
      add({ type: u <= 6 ? 'doughnut' : u > 10 ? 'hbar' : 'bar', dimension: c.id, agg: 'count' });
    });
    // 2. A measure by a category
    if (nums.length && cats.length) {
      const m = nums[0];
      const { c } = cats[0];
      const add2 = cats[0].u > 8 ? 'hbar' : 'bar';
      add({ type: add2, dimension: c.id, measure: m.id, agg: m.type === 'currency' ? 'sum' : 'avg' });
      if (cats[1] && nums[1]) add({ type: 'bar', dimension: cats[1].c.id, measure: nums[1].id, agg: nums[1].type === 'currency' ? 'sum' : 'avg' });
    }
    // 3. Trends
    if (dates.length) {
      const d = dates[0];
      if (nums.length) add({ type: 'line', dimension: d.id, measure: nums[0].id, agg: 'sum' });
      add({ type: nums.length ? 'area' : 'line', dimension: d.id, agg: 'count' });
    }
    // 4. Distributions
    if (rows.length >= 8) nums.slice(0, 2).forEach((m) => add({ type: 'histogram', measure: m.id, agg: 'count' }));
    // 5. Relationships
    if (rows.length >= 10 && nums.length >= 2) add({ type: 'scatter', xMeasure: nums[0].id, yMeasure: nums[1].id, agg: 'count' });
    // 6. Composition + spread
    if (cats.length >= 2) {
      const [a, b] = cats;
      if (b.u <= 8) add({ type: 'stacked', dimension: a.c.id, series: b.c.id, agg: 'count' });
    }
    if (nums.length && cats.length && rows.length >= 12) add({ type: 'box', measure: nums[0].id, dimension: cats[0].c.id, agg: 'count' });
  }

  // Drop anything that turns out to be unsuitable once actually computed.
  const good = [];
  for (const cfg of out) {
    let res;
    try { res = computeChart(sheet, { ...cfg, id: 'probe' }); } catch (e) { res = { ok: false, reason: e.message }; }
    if (res.ok) good.push(cfg);
    else skipped.push({ title: CHART_LABEL[cfg.type], reason: res.reason });
  }
  const configs = good.slice(0, maxCharts).map((c, i) => ({ ...c, id: `auto${i + 1}` }));
  return { configs, skipped, locked: Math.max(0, good.length - maxCharts) };
}

function kpis(sheet) {
  const rows = sheet.rows;
  const cards = [{ id: 'records', label: 'Records', value: fmtNum(rows.length), hint: `Rows in "${sheet.name}"` }];
  if (!rows.length) return cards;
  cards.push({ id: 'columns', label: 'Columns', value: fmtNum(sheet.columns.length), hint: 'Fields in the form' });
  let cells = 0;
  let filled = 0;
  for (const r of rows) for (const c of sheet.columns) { cells += 1; const v = r.v[c.id]; if (v !== null && v !== undefined && v !== '') filled += 1; }
  cards.push({ id: 'complete', label: 'Data completeness', value: pct((filled / cells) * 100, 0), hint: `${fmtNum(cells - filled)} blank cell(s)` });
  const nums = classify(sheet).number.slice(0, 3);
  for (const m of nums) {
    const vals = rows.map((r) => numOf(m, r.v[m.id])).filter((v) => v !== null);
    if (!vals.length) continue;
    const isMoney = m.type === 'currency';
    const sum = vals.reduce((a, b) => a + b, 0);
    cards.push({
      id: `m-${m.id}`,
      label: isMoney ? `Total ${m.label}` : `Average ${m.label}`,
      value: fmt(isMoney ? sum : sum / vals.length, m),
      hint: isMoney ? `Average ${fmt(sum / vals.length, m)} across ${fmtNum(vals.length)} records` : `Range ${fmt(Math.min(...vals), m)} – ${fmt(Math.max(...vals), m)}`,
    });
  }
  return cards;
}

function qualityOf(sheet) {
  const rows = sheet.rows;
  if (!rows.length || !sheet.columns.length) return { score: null, label: 'No data', blankCells: 0, dupRows: 0 };
  let cells = 0; let filled = 0;
  const seen = new Set();
  let dup = 0;
  for (const r of rows) {
    const key = [];
    for (const c of sheet.columns) { cells += 1; const v = r.v[c.id]; if (v !== null && v !== undefined && v !== '') filled += 1; key.push(v); }
    const k = JSON.stringify(key);
    if (seen.has(k)) dup += 1; else seen.add(k);
  }
  const score = Math.round((filled / cells) * 100 - Math.min(10, (dup / rows.length) * 100));
  const s = Math.max(0, score);
  return { score: s, label: s >= 90 ? 'Excellent' : s >= 75 ? 'Good' : s >= 50 ? 'Needs attention' : 'Poor', blankCells: cells - filled, dupRows: dup };
}

/** Value lists a chart builder UI needs. */
function chartOptions(sheet) {
  const cls = classify(sheet);
  const pick = (cols) => cols.map((c) => ({ id: c.id, label: c.label }));
  return { categories: pick(cls.category), numbers: pick(cls.number), dates: pick(cls.date), types: CHART_TYPES.map((t) => ({ id: t, label: CHART_LABEL[t] })), aggs: AGGS };
}

module.exports = { computeChart, normalizeConfig, suggestCharts, kpis, qualityOf, chartOptions, classify, CHART_TYPES, AGGS, CHART_LABEL };
