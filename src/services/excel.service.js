'use strict';

/**
 * Excel import / export.
 *  - Import: reads every worksheet into a generic sheet model (columns + rows) without hardcoding any schema.
 *  - Export: re-opens the ORIGINAL workbook with ExcelJS and writes the latest saved state back into it, so
 *    sheet order, column widths, styles, freeze panes, defined names and hidden sheets survive.
 *
 * Known ExcelJS limits are surfaced as notes (never silently ignored): see README "Limitations".
 */
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const { AppError } = require('../middleware/errors');
const { dateToStored, storedToDate, isStoredDate, isStoredDateTime } = require('./util');
const schema = require('./schema.service');

const MAX_UNCOMPRESSED_BYTES = 400 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 2000;
const HEADER_SCAN_ROWS = 20;

function colLetter(n) {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Validate signature + zip structure BEFORE handing bytes to the parser. */
async function validateXlsxBuffer(buffer) {
  if (!buffer || buffer.length < 100) throw new AppError(400, 'EMPTY_FILE', 'That file is empty.');
  const head = buffer.subarray(0, 8);
  if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0) {
    throw new AppError(415, 'LEGACY_XLS', 'Old .xls files are not supported yet. In Excel choose File → Save As → "Excel Workbook (*.xlsx)" and upload that file.');
  }
  if (!(head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04)) {
    throw new AppError(415, 'BAD_SIGNATURE', 'This does not look like a real .xlsx workbook.');
  }
  let zip;
  try {
    zip = await JSZip.loadAsync(buffer, { checkCRC32: false });
  } catch {
    throw new AppError(422, 'CORRUPT', 'The workbook appears to be damaged and could not be opened.');
  }
  const names = Object.keys(zip.files);
  if (names.length > MAX_ZIP_ENTRIES) throw new AppError(422, 'CORRUPT', 'The workbook structure is not valid.');
  if (!zip.file('[Content_Types].xml') || !zip.file('xl/workbook.xml')) {
    throw new AppError(415, 'NOT_XLSX', 'This is a zip file, but not an Excel workbook.');
  }
  if (names.some((n) => /vbaProject\.bin$/i.test(n))) {
    throw new AppError(415, 'MACROS', 'Workbooks with macros are not accepted. Macros are never run here. Save a copy as a plain .xlsx and try again.');
  }
  let total = 0;
  for (const n of names) {
    const size = zip.files[n]._data && zip.files[n]._data.uncompressedSize;
    if (typeof size === 'number') total += size;
  }
  if (total > MAX_UNCOMPRESSED_BYTES) throw new AppError(413, 'TOO_BIG', 'The workbook expands to an unsafe size and was rejected.');
}

// ---------------------------------------------------------------- reading cells

function plainText(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object' && Array.isArray(v.richText)) return v.richText.map((p) => p.text).join('');
  if (typeof v === 'object' && v.text !== undefined) return plainText(v.text);
  return v;
}

/** Normalised view of a cell: {value, formula, hyperlink, isDate} */
function readCell(cell) {
  let raw = cell.value;
  let formula = null;
  let hyperlink = null;
  if (raw !== null && typeof raw === 'object' && !(raw instanceof Date)) {
    if (raw.formula !== undefined || raw.sharedFormula !== undefined) {
      formula = cell.formula || raw.formula || null;
      raw = raw.result === undefined ? null : raw.result;
    }
  }
  if (raw !== null && typeof raw === 'object' && !(raw instanceof Date)) {
    if (raw.error) raw = String(raw.error);
    else if (raw.hyperlink) {
      hyperlink = raw.hyperlink;
      raw = plainText(raw.text) ?? raw.hyperlink;
    } else raw = plainText(raw);
  }
  if (raw !== null && typeof raw === 'object' && !(raw instanceof Date)) raw = String(raw);

  let value = null;
  let isDate = false;
  if (raw instanceof Date) {
    if (!Number.isNaN(raw.getTime())) { value = dateToStored(raw); isDate = true; }
  } else if (typeof raw === 'string') {
    value = raw.trim() === '' ? null : raw;
  } else if (typeof raw === 'number') {
    value = Number.isFinite(raw) ? raw : null;
  } else if (typeof raw === 'boolean') value = raw;
  return { value, formula, hyperlink, isDate };
}

function headerText(cell) {
  const c = readCell(cell).value;
  if (c === null) return '';
  return String(c).replace(/\s+/g, ' ').trim();
}

/** Guess the header row from the first rows of data. */
function detectHeaderRow(rowList) {
  const sample = rowList.slice(0, HEADER_SCAN_ROWS).map((r) => {
    let n = 0;
    let str = 0;
    r.cells.forEach((cell) => {
      const { value } = readCell(cell);
      if (value === null) return;
      n += 1;
      if (typeof value === 'string' && !schema.isNumericString(value)) str += 1;
    });
    return { rowNumber: r.rowNumber, n, str };
  }).filter((r) => r.n > 0);
  if (!sample.length) return { headerRow: null, uncertain: false };
  const maxN = Math.max(...sample.map((r) => r.n));
  const need = Math.max(1, Math.ceil(0.6 * maxN));
  const idx = sample.findIndex((r) => r.n >= need && r.str / r.n >= 0.6);
  if (idx === -1) return { headerRow: sample[0].rowNumber, uncertain: true };
  const pick = sample[idx];
  const uncertain = idx !== 0 || pick.str / pick.n < 0.8 || sample.length === 1;
  return { headerRow: pick.rowNumber, uncertain: uncertain && sample.length > 1 };
}

function collectRows(ws) {
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const cells = new Map();
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => cells.set(colNumber, cell));
    rows.push({ rowNumber, cells });
  });
  return rows;
}

/** Build one sheet model from an ExcelJS worksheet. */
function buildSheet(ws, sheetNo, limits, { headerRowOverride } = {}) {
  const allRows = collectRows(ws);
  const notes = [];
  const base = {
    id: `s${sheetNo}`,
    name: ws.name,
    excelId: ws.id,
    hidden: ws.state && ws.state !== 'visible',
    headerRow: null,
    headerUncertain: false,
    firstCol: 1,
    columns: [],
    rows: [],
    nextColNo: 1,
    nextRowNo: 1,
    charts: [],
    notes,
    stats: { blankRowsSkipped: 0, emptyColumnsSkipped: 0, formulaCells: 0, mergedRanges: 0, totalRowsInFile: allRows.length },
  };
  if (!allRows.length) {
    base.empty = true;
    notes.push({ level: 'warn', text: 'This sheet is empty, so no form or chart can be created for it.' });
    return base;
  }

  let headerRow;
  if (headerRowOverride) {
    headerRow = headerRowOverride;
    base.headerUncertain = false;
  } else {
    const det = detectHeaderRow(allRows);
    headerRow = det.headerRow;
    base.headerUncertain = det.uncertain;
  }
  const headerEntry = allRows.find((r) => r.rowNumber === headerRow);
  if (!headerEntry) {
    base.empty = true;
    notes.push({ level: 'warn', text: `Row ${headerRow} is empty, so it cannot be used as the header row.` });
    return base;
  }
  base.headerRow = headerRow;
  if (base.headerUncertain) {
    notes.push({ level: 'info', text: `We guessed that row ${headerRow} holds your column names. If that is wrong, pick the correct header row below.` });
  }
  if (headerRow > allRows[0].rowNumber) {
    notes.push({ level: 'info', text: `Rows above row ${headerRow} (such as titles) are not part of the table, but they are kept in the downloaded workbook.` });
  }

  const dataRows = allRows.filter((r) => r.rowNumber > headerRow);
  const headerCols = [...headerEntry.cells.keys()].filter((c) => headerText(headerEntry.cells.get(c)) !== '');
  let dataMin = Infinity;
  let dataMax = 0;
  const dataColsWithValues = new Set();
  for (const r of dataRows) {
    r.cells.forEach((cell, c) => {
      if (readCell(cell).value !== null) {
        dataColsWithValues.add(c);
        if (c < dataMin) dataMin = c;
        if (c > dataMax) dataMax = c;
      }
    });
  }
  const allCols = [...new Set([...headerCols, ...dataColsWithValues])];
  if (!allCols.length) {
    base.empty = true;
    notes.push({ level: 'warn', text: 'No column names or data were found below the header row.' });
    return base;
  }
  const firstCol = Math.min(...headerCols.length ? headerCols : allCols);
  const outside = [...dataColsWithValues].filter((c) => c < firstCol).length;
  if (outside) {
    notes.push({ level: 'warn', text: `${outside} column(s) to the left of the table have data but no header. They were not imported, but stay untouched in the downloaded workbook.` });
  }
  const lastCol = Math.max(...allCols);

  if (dataRows.length > limits.maxRowsPerSheet) {
    throw new AppError(402, 'PLAN_LIMIT', `Sheet "${ws.name}" has ${dataRows.length.toLocaleString('en-IN')} rows. Your plan allows up to ${limits.maxRowsPerSheet.toLocaleString('en-IN')} rows per sheet.`, { upgrade: true, limit: 'maxRowsPerSheet', max: limits.maxRowsPerSheet });
  }

  // ---- columns
  const used = new Map();
  const colDefs = [];
  for (let c = firstCol; c <= lastCol; c += 1) {
    const hc = headerEntry.cells.get(c);
    let text = hc ? headerText(hc) : '';
    const hasData = dataColsWithValues.has(c);
    if (!text && !hasData) { base.stats.emptyColumnsSkipped += 1; continue; }
    let generated = false;
    if (!text) { text = `Column ${colLetter(c)}`; generated = true; }
    const key = text.toLowerCase();
    const count = (used.get(key) || 0) + 1;
    used.set(key, count);
    let header = text;
    let dup = false;
    if (count > 1) { header = `${text} (${count})`; dup = true; }
    colDefs.push({ colNo: c, header, original: text, generated, dup });
  }
  if (colDefs.length > limits.maxColumns) {
    throw new AppError(402, 'PLAN_LIMIT', `Sheet "${ws.name}" has ${colDefs.length} columns. Your plan allows up to ${limits.maxColumns} columns per sheet.`, { upgrade: true, limit: 'maxColumns', max: limits.maxColumns });
  }
  const generatedCols = colDefs.filter((d) => d.generated).map((d) => d.header);
  const dupCols = colDefs.filter((d) => d.dup).map((d) => d.header);
  if (generatedCols.length) notes.push({ level: 'warn', text: `Some columns had no name, so we named them: ${generatedCols.join(', ')}. You can rename them.` });
  if (dupCols.length) notes.push({ level: 'warn', text: `Duplicate column names were made unique: ${dupCols.join(', ')}.` });

  // ---- rows
  const colIds = colDefs.map((d, i) => `c${i + 1}`);
  const valuesByCol = colDefs.map(() => []);
  const formulaCounts = colDefs.map(() => 0);
  const dateNative = colDefs.map(() => false);
  const numFmt = colDefs.map(() => null);
  let rowNo = 1;
  for (const r of dataRows) {
    const rec = { id: `r${rowNo}`, src: r.rowNumber, v: {} };
    let any = false;
    colDefs.forEach((d, i) => {
      const cell = r.cells.get(d.colNo);
      if (!cell) { rec.v[colIds[i]] = null; return; }
      const info = readCell(cell);
      rec.v[colIds[i]] = info.value;
      if (info.value !== null) {
        any = true;
        valuesByCol[i].push(info.value);
        if (!numFmt[i] && cell.numFmt) numFmt[i] = cell.numFmt;
      }
      if (info.isDate) dateNative[i] = true;
      if (info.formula) {
        rec.f = rec.f || {};
        rec.f[colIds[i]] = { formula: info.formula };
        formulaCounts[i] += 1;
        base.stats.formulaCells += 1;
      }
      if (info.hyperlink) {
        rec.h = rec.h || {};
        rec.h[colIds[i]] = info.hyperlink;
      }
    });
    if (!any) { base.stats.blankRowsSkipped += 1; continue; }
    base.rows.push(rec);
    rowNo += 1;
  }
  // Rows ExcelJS never returned (completely empty rows inside the table) are blank rows too.
  base.stats.blankRowsSkipped += Math.max(0, allRows[allRows.length - 1].rowNumber - headerRow - dataRows.length);
  base.nextRowNo = rowNo;
  base.nextColNo = colDefs.length + 1;
  base.firstCol = firstCol;
  base.srcLastCol = lastCol;
  base.srcLastRow = allRows[allRows.length - 1].rowNumber;
  base.columns = colDefs.map((d, i) => {
    const col = schema.columnFromInference({ id: colIds[i], sourceIndex: d.colNo, header: d.header, values: valuesByCol[i], formulaCount: formulaCounts[i] });
    col.originalHeader = d.original;
    col.dateNative = dateNative[i];
    col.numFmt = numFmt[i];
    col.isNew = false;
    return col;
  });
  // formulas: record the cached result for unchanged-value comparison on export
  for (const rec of base.rows) {
    if (!rec.f) continue;
    for (const id of Object.keys(rec.f)) rec.f[id].result = rec.v[id];
  }
  if (base.stats.blankRowsSkipped) {
    notes.push({ level: 'info', text: `${base.stats.blankRowsSkipped} completely blank row(s) were left out of the editable table.` });
  }
  if (base.stats.formulaCells) {
    notes.push({ level: 'info', text: `${base.stats.formulaCells} cell(s) contain Excel formulas. They are kept as formulas in the download until you edit them. Values are recalculated when you open the file in Excel.` });
  }
  const merges = (ws.model && ws.model.merges) || [];
  base.stats.mergedRanges = merges.length;
  if (merges.length) {
    notes.push({ level: 'warn', text: `${merges.length} merged cell range(s) found. Merges that overlap the data table are separated when you download.` });
  }
  if (ws.tables && Object.keys(ws.tables).length) {
    notes.push({ level: 'warn', text: 'This sheet contains an Excel "Table" object. It is removed from the downloaded file (the data stays) because its range can change.' });
  }
  return base;
}

/**
 * Parse a workbook buffer.
 * @returns {Promise<{sheets: object[]}>}
 */
async function parseWorkbook(buffer, limits) {
  await validateXlsxBuffer(buffer);
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer, { ignoreNodes: ['drawing', 'picture'] });
  } catch {
    throw new AppError(422, 'CORRUPT', 'We could not read this workbook. Try opening and re-saving it in Excel.');
  }
  const list = wb.worksheets;
  if (!list.length) throw new AppError(422, 'NO_SHEETS', 'This workbook has no worksheets.');
  if (list.length > limits.maxSheets) {
    throw new AppError(402, 'PLAN_LIMIT', `This workbook has ${list.length} sheets. Your plan allows up to ${limits.maxSheets}.`, { upgrade: true, limit: 'maxSheets', max: limits.maxSheets });
  }
  const sheets = list.map((ws, i) => buildSheet(ws, i + 1, limits));
  return { sheets };
}

/** Re-read a single sheet with a user-chosen header row. */
async function reparseSheet(buffer, sheet, headerRow, limits) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer, { ignoreNodes: ['drawing', 'picture'] });
  const ws = wb.getWorksheet(sheet.excelId) || wb.getWorksheet(sheet.name);
  if (!ws) throw new AppError(404, 'NOT_FOUND', 'Sheet not found.');
  const fresh = buildSheet(ws, Number(sheet.id.slice(1)), limits, { headerRowOverride: headerRow });
  fresh.id = sheet.id;
  return fresh;
}

// ---------------------------------------------------------------- export

function cellValueFor(col, v) {
  if (v === null || v === undefined || v === '') return null;
  if (schema.NUMERIC_TYPES.has(col.type) && typeof v === 'string') {
    const n = schema.toNumber(v);
    return n === null ? v : n;
  }
  if ((col.type === 'date' || col.type === 'datetime') && typeof v === 'string' && col.dateNative !== false) {
    return storedToDate(v) || v;
  }
  return v;
}

function numFmtFor(col) {
  if (col.numFmt) return col.numFmt;
  if (col.type === 'date') return 'yyyy-mm-dd';
  if (col.type === 'datetime') return 'yyyy-mm-dd hh:mm';
  if (col.type === 'currency') return '#,##0.00';
  return null;
}

function rangesIntersect(range, r1, c1, r2, c2) {
  const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(range);
  if (!m) return false;
  const toNum = (s) => s.split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0);
  const a = { c1: toNum(m[1]), r1: +m[2], c2: toNum(m[3]), r2: +m[4] };
  return !(a.r2 < r1 || a.r1 > r2 || a.c2 < c1 || a.c1 > c2);
}

/** Write the latest saved sheet state into an ExcelJS worksheet. */
function writeSheet(ws, sheet) {
  if (sheet.empty || !sheet.columns.length || !sheet.headerRow) return;
  const H = sheet.headerRow;
  const C0 = sheet.firstCol;
  const nCols = sheet.columns.length;
  const nRows = sheet.rows.length;
  const oldLastRow = sheet.srcLastRow || H;
  const oldLastCol = sheet.srcLastCol || C0 + nCols - 1;
  const clearLastRow = Math.max(oldLastRow, H + nRows);
  const clearLastCol = Math.max(oldLastCol, C0 + nCols - 1);

  // Un-merge ranges that overlap the table, remove Excel "Table" objects (ranges would be wrong).
  const merges = [...((ws.model && ws.model.merges) || [])];
  for (const m of merges) if (rangesIntersect(m, H, C0, clearLastRow, clearLastCol)) { try { ws.unMergeCells(m); } catch { /* already gone */ } }
  if (ws.tables) for (const name of Object.keys(ws.tables)) { try { ws.removeTable(name); } catch { /* ignore */ } }

  // Snapshot every style / width we might move BEFORE writing anything.
  const colWidth = new Map();
  const headerStyle = new Map();
  const needStyle = new Set();
  const plan = []; // output cells
  const keyOf = (r, c) => r * 100000 + c;
  const firstHeaderStyleCol = sheet.columns.find((c) => c.sourceIndex);

  sheet.columns.forEach((col, j) => {
    const abs = C0 + j;
    if (col.sourceIndex) {
      colWidth.set(col.id, ws.getColumn(col.sourceIndex).width);
      headerStyle.set(col.id, ws.getCell(H, col.sourceIndex).style);
    }
    if (col.sourceIndex && col.sourceIndex !== abs) needStyle.add(keyOf(-1, col.sourceIndex));
  });
  const snap = new Map();
  sheet.rows.forEach((row, k) => {
    const R = H + 1 + k;
    sheet.columns.forEach((col, j) => {
      const abs = C0 + j;
      let styleFrom = null;
      if (col.sourceIndex && row.src) {
        if (row.src !== R || col.sourceIndex !== abs) {
          styleFrom = keyOf(row.src, col.sourceIndex);
          needStyle.add(styleFrom);
        }
      }
      plan.push({ R, abs, col, row, styleFrom, inPlace: Boolean(col.sourceIndex && row.src === R && col.sourceIndex === abs) });
    });
  });
  for (const key of needStyle) {
    const r = Math.floor(key / 100000);
    const c = key % 100000;
    if (r > 0) snap.set(key, ws.getCell(r, c).style);
  }
  // Fallback style for brand-new cells: copy from the first data row of the same source column, else nothing.
  const sampleStyle = new Map();
  for (const col of sheet.columns) {
    if (col.sourceIndex) sampleStyle.set(col.id, ws.getCell(H + 1, col.sourceIndex).style);
  }

  // Clear everything the old table occupied.
  for (let r = H; r <= clearLastRow; r += 1) {
    for (let c = C0; c <= clearLastCol; c += 1) {
      const cell = ws.getCell(r, c);
      cell.value = null;
      if (r > H + nRows || c > C0 + nCols - 1) cell.style = {};
      cell.dataValidation = undefined;
    }
  }

  // Header
  sheet.columns.forEach((col, j) => {
    const cell = ws.getCell(H, C0 + j);
    cell.value = col.header;
    const st = headerStyle.get(col.id) || (firstHeaderStyleCol ? headerStyle.get(firstHeaderStyleCol.id) : null);
    if (st) cell.style = st;
    else cell.font = { bold: true };
    const w = colWidth.get(col.id);
    ws.getColumn(C0 + j).width = w || Math.max(12, Math.min(40, col.header.length + 4));
  });

  // Body
  for (const p of plan) {
    const { col, row } = p;
    const cell = ws.getCell(p.R, p.abs);
    const v = row.v[col.id] ?? null;
    const f = row.f && row.f[col.id];
    const h = row.h && row.h[col.id];
    const out = cellValueFor(col, v);
    if (f && f.formula) cell.value = { formula: f.formula, result: out === null ? undefined : out };
    else if (h && out !== null) cell.value = { text: String(out), hyperlink: h };
    else cell.value = out;

    if (!p.inPlace) {
      const st = p.styleFrom ? snap.get(p.styleFrom) : sampleStyle.get(col.id);
      if (st && Object.keys(st).length) cell.style = st;
    }
    const fmt = numFmtFor(col);
    if (out !== null && fmt && (!cell.numFmt || cell.numFmt === 'General') && (out instanceof Date || typeof out === 'number')) {
      cell.numFmt = fmt;
    }
  }

  // Dropdown columns become real Excel dropdowns (only when the list fits Excel's 255-char limit).
  sheet.columns.forEach((col, j) => {
    if ((col.type === 'dropdown' || col.type === 'searchable') && col.options.length) {
      const joined = col.options.join(',');
      if (joined.length <= 250 && !col.options.some((o) => /[",]/.test(o))) {
        for (let k = 0; k < nRows; k += 1) {
          ws.getCell(H + 1 + k, C0 + j).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${joined}"`] };
        }
      }
    }
  });

  if (ws.autoFilter) {
    ws.autoFilter = { from: { row: H, column: C0 }, to: { row: H, column: C0 + nCols - 1 } };
  }
}

async function buildExport(originalBuffer, state) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(originalBuffer);
  for (const sheet of state.sheets) {
    const ws = wb.getWorksheet(sheet.excelId) || wb.getWorksheet(sheet.name);
    if (ws) writeSheet(ws, sheet);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------------------------------------------------------------- CSV

function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v);
  // CSV / formula-injection defence: neutralise leading = + - @ tab CR in TEXT values.
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s) && !schema.isNumericString(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function sheetToCsv(sheet) {
  const lines = [sheet.columns.map((c) => csvCell(c.header)).join(',')];
  for (const r of sheet.rows) lines.push(sheet.columns.map((c) => csvCell(r.v[c.id])).join(','));
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

module.exports = { parseWorkbook, reparseSheet, buildExport, sheetToCsv, validateXlsxBuffer, csvCell, colLetter, isStoredDate, isStoredDateTime };
