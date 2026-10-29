'use strict';

/**
 * Schema engine: field-type inference, validation/coercion and column management.
 * Inferred types are SUGGESTIONS. Every inference carries a plain-language reason and a confidence.
 */
const { AppError } = require('../middleware/errors');
const { humanize, isStoredDate, isStoredDateTime } = require('./util');

const TYPES = [
  'text', 'textarea', 'integer', 'decimal', 'currency', 'date', 'datetime',
  'boolean', 'dropdown', 'searchable', 'email', 'url', 'phone', 'readonly',
];
const NUMERIC_TYPES = new Set(['integer', 'decimal', 'currency']);
const STRING_TYPES = new Set(['text', 'textarea', 'email', 'url', 'phone', 'dropdown', 'searchable']);

const TYPE_INFO = {
  text: 'Short text',
  textarea: 'Long text (multi-line)',
  integer: 'Whole number',
  decimal: 'Decimal number',
  currency: 'Money amount',
  date: 'Date',
  datetime: 'Date and time',
  boolean: 'Checkbox (yes / no)',
  dropdown: 'Dropdown list',
  searchable: 'Searchable dropdown',
  email: 'Email address',
  url: 'Web link',
  phone: 'Phone number',
  readonly: 'Read-only (calculated)',
};

const MAX_CELL_CHARS = 32767; // Excel limit
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const URL_LIKE_RE = /^https?:\/\/\S+$/i;
const PHONE_RE = /^\+?[\d\s().-]{5,22}$/;

const TRUE_WORDS = new Set(['true', 'yes', 'y', '1']);
const FALSE_WORDS = new Set(['false', 'no', 'n', '0']);
const COMPLEMENT = { true: 'false', yes: 'no', y: 'n', 1: 0, false: 'true', no: 'yes', n: 'y', 0: 1 };

const HINT = {
  email: /e-?mail/,
  url: /\b(url|website|web ?site|link|homepage|linkedin)\b/,
  phone: /\b(phone|mobile|tel|telephone|whatsapp|cell|contact (no|number|num))\b/,
  idLike: /\b(id|uid|code|sku|ref|reference|serial|survey|account|acct|pin|pincode|zip|postal|aadhaar|aadhar|pan|gstin|gst|ifsc|isbn|barcode|roll|number)\b|\b(no|num)\.?$|#$/,
  long: /\b(description|notes?|comments?|remarks?|address|details?|summary|feedback|reason|message|bio)\b/,
  money: /\b(amount|price|cost|salary|revenue|fee|fees|expense|expenses|budget|balance|sales|profit|income|payment|rent|mrp|tax|discount|total)\b/,
  bool: /^(is|has|have|was|are|can)\b|\b(active|enabled|completed|paid|approved|verified|flag|done)\b/,
  category: /\b(status|state|stage|category|type|department|dept|priority|grade|class|gender|city|region|source|mode)\b/,
};

const lc = (s) => String(s ?? '').toLowerCase();

function isNumericString(s) {
  return typeof s === 'string' && /^-?\d+(\.\d+)?$/.test(s.trim());
}

function toNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && isNumericString(v)) {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function matchCase(template, word) {
  const w = String(word);
  if (template === template.toUpperCase() && template.length > 1) return w.toUpperCase();
  if (template.charAt(0) === template.charAt(0).toUpperCase()) return w.charAt(0).toUpperCase() + w.slice(1);
  return w;
}

/** Find how a boolean-ish column is spelled in the file so the export keeps the same words. */
function detectBoolLabels(values) {
  const present = values.filter((v) => v !== null && v !== undefined);
  if (present.length && present.every((v) => typeof v === 'boolean')) return { boolTrue: true, boolFalse: false };
  let t;
  let f;
  for (const v of present) {
    const k = lc(v);
    if (t === undefined && TRUE_WORDS.has(k)) t = v;
    if (f === undefined && FALSE_WORDS.has(k)) f = v;
  }
  if (t === undefined && f === undefined) return { boolTrue: true, boolFalse: false };
  if (t === undefined) {
    const c = COMPLEMENT[lc(f)];
    t = typeof f === 'number' ? c : matchCase(String(f), c);
  }
  if (f === undefined) {
    const c = COMPLEMENT[lc(t)];
    f = typeof t === 'number' ? c : matchCase(String(t), c);
  }
  return { boolTrue: t, boolFalse: f };
}

function boolFromStored(col, v) {
  if (v === null || v === undefined || v === '') return null;
  if (v === col.boolTrue || (typeof v === 'string' && typeof col.boolTrue === 'string' && lc(v) === lc(col.boolTrue))) return true;
  if (v === col.boolFalse || (typeof v === 'string' && typeof col.boolFalse === 'string' && lc(v) === lc(col.boolFalse))) return false;
  const k = lc(v);
  if (TRUE_WORDS.has(k)) return true;
  if (FALSE_WORDS.has(k)) return false;
  return null;
}

function uniqueOptions(values, cap = 100) {
  const seen = new Set();
  for (const v of values) {
    if (v === null || v === undefined) continue;
    seen.add(String(v));
    if (seen.size > 5000) break;
  }
  return [...seen].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })).slice(0, cap);
}

function suggestHelp(type, label) {
  const l = label.toLowerCase();
  switch (type) {
    case 'text': return `Type the ${l}.`;
    case 'textarea': return `Add details for ${l}. You can write several lines.`;
    case 'integer': return `Enter a whole number for ${l}.`;
    case 'decimal': return `Enter a number for ${l}. Decimals are allowed.`;
    case 'currency': return `Enter the amount for ${l}. Numbers only, no currency symbol.`;
    case 'date': return `Pick the date for ${l}.`;
    case 'datetime': return `Pick the date and time for ${l}.`;
    case 'boolean': return `Tick the box if ${l} applies to this record.`;
    case 'dropdown': return `Choose one ${l} from the list.`;
    case 'searchable': return `Start typing to find the ${l}, then pick it from the list.`;
    case 'email': return 'Enter a full email address, for example name@example.com.';
    case 'url': return 'Enter a web address starting with http:// or https://.';
    case 'phone': return 'Enter the phone number. Leading zeros and + signs are kept exactly as typed.';
    case 'readonly': return `${label} is calculated by a formula in your workbook, so it cannot be edited here.`;
    default: return '';
  }
}

function suggestPlaceholder(type, label) {
  const l = label.toLowerCase();
  switch (type) {
    case 'text': return `Enter ${l}`;
    case 'textarea': return `Write ${l}…`;
    case 'integer': return '0';
    case 'decimal': case 'currency': return '0.00';
    case 'email': return 'name@example.com';
    case 'url': return 'https://';
    case 'phone': return '+91 98765 43210';
    case 'dropdown': case 'searchable': return `Select ${l}`;
    default: return '';
  }
}

/**
 * Infer a suggested field configuration from the header and the existing non-null values.
 * @returns {{type, confidence, reason, options?, boolTrue?, boolFalse?}}
 */
function inferColumn(header, values, { formulaCount = 0 } = {}) {
  const h = lc(humanize(header) || header);
  const n = values.length;
  const done = (type, confidence, reason, extra = {}) => ({ type, confidence, reason, ...extra });

  if (n === 0) return done('text', 'low', 'This column has no data yet, so it starts as a plain text field.');
  if (formulaCount / n >= 0.8) {
    return done('readonly', 'high', 'Most cells in this column are Excel formulas, so it is shown as read-only. Recalculation happens in Excel.');
  }

  const idLike = HINT.idLike.test(h);
  const money = HINT.money.test(h);
  const kinds = new Set(values.map((v) => (v === null ? 'null' : typeof v)));

  // Dates (stored as ISO strings by the importer)
  const strs = values.filter((v) => typeof v === 'string');
  if (strs.length === n && strs.every((s) => isStoredDate(s) || isStoredDateTime(s))) {
    const allDateOnly = strs.every(isStoredDate);
    return done(allDateOnly ? 'date' : 'datetime', 'high', 'Every value in this column is a valid date' + (allDateOnly ? '.' : ' with a time.'));
  }

  // Booleans
  if (kinds.size === 1 && kinds.has('boolean')) {
    return done('boolean', 'high', 'Every value is TRUE or FALSE.', detectBoolLabels(values));
  }
  const boolHint = HINT.bool.test(h);
  const uniq = new Set(values.map(lc));
  const boolish = [...uniq].every((k) => TRUE_WORDS.has(k) || FALSE_WORDS.has(k));
  const hasText = values.some((v) => typeof v === 'string' && !/^\d+$/.test(v));
  if (boolish && uniq.size <= 2 && (hasText || boolHint)) {
    return done('boolean', hasText ? 'high' : 'medium', 'The only values used are yes/no style answers, so a checkbox is the clearest control.', detectBoolLabels(values));
  }

  // Numbers
  if (kinds.size === 1 && kinds.has('number')) {
    if (idLike && !money) {
      return done('text', 'high', 'This looks like an ID or code. It is kept as text so leading zeros and exact digits never change.');
    }
    const allInt = values.every(Number.isInteger);
    const digits = values.every((v) => allInt && Math.abs(v) >= 1e9);
    if (HINT.phone.test(h)) return done('phone', 'medium', 'The header mentions a phone number. It is kept exact and not treated as a calculable number.');
    if (digits && !money) {
      return done('text', 'medium', 'Very long whole numbers are usually IDs or phone numbers, so they are kept as text. Change this if they are real quantities.');
    }
    if (money) return done('currency', 'medium', 'The header looks like a money amount and every value is a number.');
    return allInt
      ? done('integer', 'high', 'Every value is a whole number.')
      : done('decimal', 'high', 'Every value is a number and some have decimals.');
  }

  if (kinds.size > 1) {
    return done('text', 'low', 'This column mixes numbers and text, so it is kept as safe, editable text.');
  }

  // Text-only from here
  const nums = strs.every(isNumericString);
  if (nums && HINT.phone.test(h) && strs.every((s) => /^\d{5,15}$/.test(s.trim()))) {
    return done('phone', 'medium', 'The header mentions a phone number. Values are kept exactly as text, so leading zeros are never lost.');
  }
  if (nums) {
    return done('text', 'high', 'These are numbers stored as text (for example IDs or codes). They stay text so leading zeros are never lost.');
  }
  const ratio = (re) => strs.filter((s) => re.test(s.trim())).length / n;
  if (ratio(EMAIL_RE) >= 0.9 || (HINT.email.test(h) && ratio(EMAIL_RE) >= 0.5)) {
    return done('email', 'high', 'Most values look like email addresses.');
  }
  if (ratio(URL_LIKE_RE) >= 0.9 || (HINT.url.test(h) && ratio(URL_LIKE_RE) >= 0.5)) {
    return done('url', 'high', 'Most values look like web links.');
  }
  if (HINT.phone.test(h) && ratio(PHONE_RE) >= 0.8) {
    return done('phone', 'high', 'The header mentions a phone number and the values look like phone numbers.');
  }

  const lens = strs.map((s) => s.length);
  const maxLen = Math.max(...lens);
  const avgLen = lens.reduce((a, b) => a + b, 0) / n;
  const multiline = strs.some((s) => s.includes('\n'));
  if (avgLen > 60 || maxLen > 150 || multiline || (HINT.long.test(h) && maxLen > 20)) {
    return done('textarea', 'medium', 'The values are long or the header suggests notes, so a multi-line box is used.');
  }

  const unique = uniq.size;
  const catHint = HINT.category.test(h);
  if (!idLike || catHint) {
    if (n >= 3 && unique >= 1 && unique <= 20 && maxLen <= 40 && (unique / n <= 0.5 || (catHint && unique < n))) {
      return done('dropdown', 'medium', `Only ${unique} different value${unique === 1 ? '' : 's'} repeat across ${n} records, so a dropdown keeps entries consistent.`, { options: uniqueOptions(values) });
    }
    if (n >= 20 && unique > 20 && unique <= 100 && maxLen <= 40 && unique / n <= 0.3) {
      return done('searchable', 'medium', `${unique} different values repeat often, so a searchable dropdown is easier than scrolling.`, { options: uniqueOptions(values) });
    }
  }
  return done('text', 'medium', 'Mostly unique text values, so a plain text field is the safest choice.');
}

function defaultColumn(overrides = {}) {
  return {
    id: '',
    sourceIndex: null,
    originalHeader: null,
    header: '',
    label: '',
    type: 'text',
    helpText: '',
    helpSuggested: false,
    placeholder: '',
    required: false,
    options: [],
    defaultValue: null,
    readOnly: false,
    visible: true,
    inTable: true,
    chartable: true,
    validation: {},
    boolTrue: true,
    boolFalse: false,
    confidence: 'high',
    inferReason: '',
    isNew: false,
    ...overrides,
  };
}

function columnFromInference({ id, sourceIndex, header, values, formulaCount }) {
  const inf = inferColumn(header, values, { formulaCount });
  const label = humanize(header) || header;
  const col = defaultColumn({
    id,
    sourceIndex,
    originalHeader: header,
    header,
    label,
    type: inf.type,
    confidence: inf.confidence,
    inferReason: inf.reason,
    options: inf.options || [],
    helpText: suggestHelp(inf.type, label),
    helpSuggested: true,
    placeholder: suggestPlaceholder(inf.type, label),
    readOnly: inf.type === 'readonly',
  });
  if (inf.type === 'boolean') {
    col.boolTrue = inf.boolTrue;
    col.boolFalse = inf.boolFalse;
  }
  if (inf.type === 'text' && inf.confidence === 'high' && HINT.idLike.test(lc(label))) col.chartable = false;
  if (['textarea', 'email', 'url', 'phone'].includes(inf.type)) col.chartable = false;
  return col;
}

// ---------------------------------------------------------------- validation / coercion

function sameValue(a, b) {
  if (a === b) return true;
  if (a === null || a === undefined) return b === null || b === undefined || b === '';
  if (b === null || b === undefined) return a === '';
  return String(a) === String(b);
}

/**
 * Validate and normalise one value for a column.
 * @returns {{value: any, error?: string}}
 */
function coerceValue(col, raw) {
  const empty = raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '');
  if (empty) {
    return col.required ? { value: null, error: 'This field is required.' } : { value: null };
  }
  const v = col.validation || {};
  const type = col.type;

  if (NUMERIC_TYPES.has(type)) {
    let n = raw;
    if (typeof raw === 'string') {
      const s = raw.trim().replace(/^(-?\d{1,3}(?:,\d{3})+(?:\.\d+)?)$/, (m) => m.replace(/,/g, ''));
      n = isNumericString(s) ? Number(s) : NaN;
    }
    if (typeof n !== 'number' || !Number.isFinite(n)) return { value: null, error: 'Enter a valid number.' };
    if (type === 'integer' && !Number.isInteger(n)) return { value: null, error: 'Enter a whole number (no decimals).' };
    if (v.min !== undefined && n < v.min) return { value: null, error: `Must be at least ${v.min}.` };
    if (v.max !== undefined && n > v.max) return { value: null, error: `Must be at most ${v.max}.` };
    return { value: n };
  }

  if (type === 'date' || type === 'datetime') {
    const s = typeof raw === 'string' ? raw.trim().replace(' ', 'T') : '';
    if (type === 'date') {
      return isStoredDate(s) ? { value: s } : { value: null, error: 'Pick a valid date (YYYY-MM-DD).' };
    }
    if (isStoredDateTime(s)) return { value: s };
    if (isStoredDate(s)) return { value: s };
    return { value: null, error: 'Pick a valid date and time.' };
  }

  if (type === 'boolean') {
    let b = null;
    if (typeof raw === 'boolean') b = raw;
    else {
      const k = lc(raw);
      if (TRUE_WORDS.has(k)) b = true;
      else if (FALSE_WORDS.has(k)) b = false;
    }
    if (b === null) return { value: null, error: 'Choose yes or no.' };
    return { value: b ? col.boolTrue : col.boolFalse };
  }

  // string-like
  if (typeof raw === 'object') return { value: null, error: 'Enter plain text.' };
  let s = typeof raw === 'string' ? raw : String(raw);
  if (type !== 'textarea' && /[\r\n]/.test(s)) s = s.replace(/\s*[\r\n]+\s*/g, ' ');
  if (CONTROL_RE.test(s)) return { value: null, error: 'Contains characters that Excel cannot store.' };
  const max = Math.min(v.maxLength ?? MAX_CELL_CHARS, MAX_CELL_CHARS);
  if (s.length > max) return { value: null, error: `Must be ${max} characters or fewer.` };
  if (v.minLength !== undefined && s.trim().length < v.minLength) return { value: null, error: `Must be at least ${v.minLength} characters.` };

  if (type === 'email') {
    s = s.trim();
    if (s.length > 254 || !EMAIL_RE.test(s)) return { value: null, error: 'Enter a valid email address.' };
  } else if (type === 'url') {
    s = s.trim();
    let ok = false;
    try {
      const u = new URL(s);
      ok = ['http:', 'https:', 'mailto:'].includes(u.protocol) && s.length <= 2048;
    } catch { /* invalid */ }
    if (!ok) return { value: null, error: 'Enter a web address starting with http:// or https://.' };
  } else if (type === 'phone') {
    s = s.trim();
    const digits = s.replace(/\D/g, '').length;
    if (!PHONE_RE.test(s) || digits < 5 || digits > 15) return { value: null, error: 'Enter a valid phone number.' };
  } else if (type === 'dropdown' || type === 'searchable') {
    if (col.options.length && !col.options.includes(s)) return { value: null, error: 'Pick one of the listed options.' };
  }
  return { value: s };
}

// ---------------------------------------------------------------- column configuration

const BOOL_FIELDS = ['required', 'readOnly', 'visible', 'inTable', 'chartable'];

function fail(errors, key, field, message) {
  errors[key] = errors[key] || {};
  errors[key][field] = message;
}

function cleanText(v, max) {
  if (typeof v !== 'string') return null;
  const s = v.replace(CONTROL_RE, '').trim();
  return s.length > max ? null : s;
}

function cleanNumber(v) {
  if (v === '' || v === null || v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Merge client-supplied settings into a column. Returns the new column; records field errors.
 */
function mergeColumnInput(base, input, key, errors, rowsForOptions) {
  const col = { ...base, validation: { ...base.validation }, options: [...base.options] };
  const typeChanged = input.type !== undefined && input.type !== base.type;

  if (input.label !== undefined) {
    const s = cleanText(input.label, 120);
    if (!s) fail(errors, key, 'label', 'Label is required (max 120 characters).');
    else col.label = s;
  }
  if (input.header !== undefined) {
    const s = cleanText(input.header, 255);
    if (!s) fail(errors, key, 'header', 'Excel header is required (max 255 characters).');
    else col.header = s;
  }
  if (input.type !== undefined) {
    if (!TYPES.includes(input.type)) fail(errors, key, 'type', 'Unknown field type.');
    else col.type = input.type;
  }
  for (const f of ['helpText', 'placeholder']) {
    if (input[f] !== undefined) {
      const s = cleanText(input[f] ?? '', f === 'helpText' ? 300 : 100);
      if (s === null) fail(errors, key, f, 'Text is too long.');
      else {
        col[f] = s;
        if (f === 'helpText' && s !== base.helpText) col.helpSuggested = false;
      }
    }
  }
  for (const f of BOOL_FIELDS) {
    if (input[f] !== undefined) col[f] = Boolean(input[f]);
  }
  if (input.options !== undefined) {
    if (!Array.isArray(input.options)) fail(errors, key, 'options', 'Options must be a list.');
    else {
      const seen = new Set();
      const out = [];
      for (const o of input.options) {
        const s = cleanText(String(o ?? ''), 80);
        if (s === null) { fail(errors, key, 'options', 'Each option must be 80 characters or fewer.'); break; }
        if (s && !seen.has(s)) { seen.add(s); out.push(s); }
      }
      if (out.length > 200) fail(errors, key, 'options', 'Use 200 options or fewer.');
      col.options = out.slice(0, 200);
    }
  }
  if (input.validation !== undefined && input.validation && typeof input.validation === 'object') {
    const nv = {};
    for (const f of ['min', 'max', 'minLength', 'maxLength']) {
      const n = cleanNumber(input.validation[f]);
      if (Number.isNaN(n)) fail(errors, key, f, 'Enter a number.');
      else if (n !== undefined) nv[f] = f.endsWith('Length') ? Math.max(0, Math.floor(n)) : n;
    }
    if (nv.min !== undefined && nv.max !== undefined && nv.min > nv.max) fail(errors, key, 'min', 'Minimum cannot be larger than maximum.');
    col.validation = nv;
  }

  if (typeChanged || !col.options.length) {
    if ((col.type === 'dropdown' || col.type === 'searchable') && !col.options.length && rowsForOptions) {
      col.options = uniqueOptions(rowsForOptions);
    }
  }
  if (typeChanged && col.type === 'boolean' && rowsForOptions) {
    Object.assign(col, detectBoolLabels(rowsForOptions));
  }
  if (typeChanged) {
    if (col.type === 'readonly') col.readOnly = true;
    else if (base.type === 'readonly') col.readOnly = false;
    col.confidence = 'high';
    col.inferReason = 'Set by you.';
    if (col.helpSuggested) col.helpText = suggestHelp(col.type, col.label);
    if (!base.placeholder || base.placeholder === suggestPlaceholder(base.type, base.label)) {
      col.placeholder = suggestPlaceholder(col.type, col.label);
    }
  }

  if (input.defaultValue !== undefined) {
    if (input.defaultValue === null || input.defaultValue === '') col.defaultValue = null;
    else {
      const probe = { ...col, required: false };
      const r = coerceValue(probe, input.defaultValue);
      if (r.error) fail(errors, key, 'defaultValue', r.error);
      else col.defaultValue = r.value;
    }
  }
  return col;
}

/**
 * Apply a full, ordered column list to a sheet. Atomic: throws before mutating on any error.
 * Existing columns missing from the list are deleted ONLY if listed in confirmDelete.
 */
function applySchemaUpdate(sheet, payload, { maxColumns }) {
  const incoming = payload && payload.columns;
  if (!Array.isArray(incoming) || incoming.length < 1) throw new AppError(400, 'BAD_SCHEMA', 'Keep at least one column.');
  if (incoming.length > maxColumns) {
    throw new AppError(402, 'PLAN_LIMIT', `Your plan allows up to ${maxColumns} columns per sheet.`, { upgrade: true, limit: 'maxColumns', max: maxColumns });
  }
  const confirm = new Set(Array.isArray(payload.confirmDelete) ? payload.confirmDelete : []);
  const existing = new Map(sheet.columns.map((c) => [c.id, c]));
  const keep = new Set();
  const errors = {};
  const next = [];
  const headersSeen = new Map();
  let nextNo = sheet.nextColNo;
  const added = [];

  incoming.forEach((inp, i) => {
    if (!inp || typeof inp !== 'object') { fail(errors, i, 'label', 'Invalid column.'); return; }
    const key = inp.id && existing.has(inp.id) ? inp.id : `new:${i}`;
    let base;
    if (inp.id && existing.has(inp.id)) {
      if (keep.has(inp.id)) { fail(errors, key, 'label', 'Duplicate column.'); return; }
      keep.add(inp.id);
      base = existing.get(inp.id);
    } else if (!inp.id || String(inp.id).startsWith('new')) {
      base = defaultColumn({ id: `c${nextNo++}`, isNew: true });
      if (inp.label === undefined && inp.header === undefined) fail(errors, key, 'label', 'Give the new column a name.');
      if (inp.label !== undefined && inp.header === undefined) inp = { ...inp, header: inp.label };
      if (inp.header !== undefined && inp.label === undefined) inp = { ...inp, label: humanize(inp.header) || inp.header };
      if (inp.type === undefined) inp = { ...inp, type: 'text' };
      if (inp.helpText === undefined) base.helpSuggested = true;
      added.push(base.id);
    } else {
      fail(errors, key, 'label', 'Unknown column.');
      return;
    }
    const sample = sheet.rows.slice(0, 5000).map((r) => r.v[base.id] ?? null).filter((v) => v !== null);
    const col = mergeColumnInput(base, inp, key, errors, sample);
    if (base.isNew && col.helpSuggested && !col.helpText) col.helpText = suggestHelp(col.type, col.label);
    if (base.isNew && !col.placeholder) col.placeholder = suggestPlaceholder(col.type, col.label);
    const hk = col.header.toLowerCase();
    if (headersSeen.has(hk)) {
      fail(errors, key, 'header', 'Another column already uses this Excel header.');
      fail(errors, headersSeen.get(hk), 'header', 'Another column already uses this Excel header.');
    } else headersSeen.set(hk, key);
    next.push(col);
  });

  const removed = sheet.columns.filter((c) => !keep.has(c.id));
  const unconfirmed = removed.filter((c) => !confirm.has(c.id));
  if (Object.keys(errors).length) {
    throw new AppError(422, 'VALIDATION', 'Some field settings need fixing.', { fieldErrors: errors });
  }
  if (unconfirmed.length) {
    throw new AppError(409, 'DELETE_NOT_CONFIRMED', 'Deleting a column removes its data from the exported workbook. Please confirm.', {
      columns: unconfirmed.map((c) => ({ id: c.id, label: c.label })),
    });
  }
  const renamedHeaders = next.filter((c) => !c.isNew && existing.get(c.id) && existing.get(c.id).header !== c.header).length;

  // ---- commit (no failures past this point)
  for (const c of removed) {
    for (const r of sheet.rows) {
      delete r.v[c.id];
      if (r.f) delete r.f[c.id];
      if (r.h) delete r.h[c.id];
    }
  }
  for (const id of added) {
    const col = next.find((c) => c.id === id);
    if (col.defaultValue !== null && col.defaultValue !== undefined) {
      for (const r of sheet.rows) r.v[id] = col.defaultValue;
    }
  }
  sheet.nextColNo = nextNo;
  sheet.columns = next.map((c) => ({ ...c, isNew: c.isNew }));
  if (sheet.charts) {
    const ids = new Set(sheet.columns.map((c) => c.id));
    sheet.charts = sheet.charts.filter((ch) => [ch.config.dimension, ch.config.measure, ch.config.series, ch.config.xMeasure, ch.config.yMeasure, ch.config.dateCol, ...(ch.config.filters || []).map((f) => f.col)].filter(Boolean).every((x) => ids.has(x)));
  }
  return { added: added.length, removed: removed.length, renamedHeaders };
}

module.exports = {
  TYPES, TYPE_INFO, NUMERIC_TYPES, STRING_TYPES, MAX_CELL_CHARS,
  inferColumn, columnFromInference, defaultColumn, coerceValue, sameValue,
  applySchemaUpdate, mergeColumnInput, suggestHelp, suggestPlaceholder, uniqueOptions,
  detectBoolLabels, boolFromStored, toNumber, isNumericString,
};
