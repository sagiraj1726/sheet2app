'use strict';

const crypto = require('crypto');

const newId = (bytes = 16) => crypto.randomBytes(bytes).toString('hex');
const WORKSPACE_ID_RE = /^[a-f0-9]{32}$/;
const SHORT_ID_RE = /^[a-z][a-z0-9]{1,15}$/;

/** "MR_Status" -> "MR Status", "joiningDate" -> "Joining Date" */
function humanize(header) {
  let s = String(header ?? '').trim();
  if (!s) return '';
  s = s.replace(/[_\-.]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim();
  return s
    .split(' ')
    .map((w) => (w === w.toUpperCase() && w.length <= 5 ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

const pad = (n, l = 2) => String(n).padStart(l, '0');

/** Date -> 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm[:ss]' using UTC (ExcelJS returns UTC wall-clock). */
function dateToStored(d) {
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const s = d.getUTCSeconds();
  if (!h && !m && !s) return date;
  return `${date}T${pad(h)}:${pad(m)}${s ? ':' + pad(s) : ''}`;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

function isRealDate(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function isStoredDate(s) {
  const m = typeof s === 'string' && DATE_RE.exec(s);
  return Boolean(m) && isRealDate(+m[1], +m[2], +m[3]);
}

function isStoredDateTime(s) {
  const m = typeof s === 'string' && DATETIME_RE.exec(s);
  if (!m) return false;
  return isRealDate(+m[1], +m[2], +m[3]) && +m[4] < 24 && +m[5] < 60 && (m[6] === undefined || +m[6] < 60);
}

/** 'YYYY-MM-DD[THH:mm[:ss]]' -> Date (UTC) or null */
function storedToDate(s) {
  if (typeof s !== 'string') return null;
  const m = DATETIME_RE.exec(s) || DATE_RE.exec(s);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Number formatting used in explanations (Indian digit grouping). */
function fmtNum(n, { decimals } = {}) {
  if (n === null || n === undefined || Number.isNaN(n)) return '–';
  const isInt = Number.isInteger(n);
  const d = decimals ?? (isInt ? 0 : Math.abs(n) >= 100 ? 0 : 2);
  return n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: d });
}

function median(sorted) {
  const n = sorted.length;
  if (!n) return null;
  return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

/** Linear-interpolated quantile on an ascending array. */
function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
}

module.exports = {
  newId,
  WORKSPACE_ID_RE,
  SHORT_ID_RE,
  humanize,
  dateToStored,
  isStoredDate,
  isStoredDateTime,
  storedToDate,
  fmtNum,
  median,
  quantile,
};
