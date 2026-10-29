# Sheet2App — Developer Guide

A production-minded, database-free Node.js application that converts Excel workbooks into interactive web applications.

---

## Table of Contents

1. [Architecture overview](#architecture-overview)
2. [Project structure](#project-structure)
3. [Data model](#data-model)
4. [API reference](#api-reference)
5. [Key services](#key-services)
6. [Frontend modules](#frontend-modules)
7. [Security model](#security-model)
8. [Plans and feature limits](#plans-and-feature-limits)
9. [Testing](#testing)
10. [Adding a new feature](#adding-a-new-feature)
11. [Environment variables](#environment-variables)
12. [Known limitations](#known-limitations)

---

## Architecture Overview

```
Browser
  │
  │  HTTP (localhost only)
  ▼
Express (app.js)
  ├── Helmet CSP + rate limiter
  ├── Session cookie (anonymous, SameSite=Strict)
  ├── CSRF guard (x-requested-with header)
  │
  ├── /api/workbooks/upload    ← Multer + ExcelJS
  ├── /api/workbooks/:id       ← CRUD + schema + undo
  ├── /api/workbooks/:id/sheets/:sid/insights  ← charts
  ├── /api/workbooks/:id/export.xlsx           ← ExcelJS write
  ├── /api/config  /api/health  /api/samples
  │
  └── /public  (index.html, app.html, styles.css, /js/*)
        └── Served as static files (no build step)

Storage (disk, no database)
  storage/workspaces/<32-hex-id>/
    original.xlsx   ← original upload bytes
    state.json      ← sheets + records + schema (atomic write)
    state.json.bak  ← previous state (recovery)
    undo.json       ← up to 8 undo snapshots
    meta.json       ← owner hash, timestamps, expiry
```

---

## Project Structure

```
sheet2app/
├── server.js              Entry point — binds port, starts cleanup timer
├── app.js                 Express factory (createApp) — middleware + routes
├── package.json
├── .env.example
│
├── src/
│   ├── config/
│   │   ├── index.js       All env vars with typed defaults
│   │   └── plans.js       PLANS map, effectiveLimits(), publicPlans()
│   │
│   ├── middleware/
│   │   ├── errors.js      AppError class + global error handler
│   │   └── security.js    Session cookie, CSRF guard, safeEqual()
│   │
│   ├── routes/
│   │   ├── upload.js      POST /upload, POST /sample
│   │   ├── workbooks.js   GET/DELETE workbook, submit records, PUT schema, undo
│   │   ├── insights.js    GET insights, POST preview/save/delete charts
│   │   ├── export.js      GET export.xlsx, GET export.csv
│   │   ├── meta.js        GET /health, GET /config, POST /upgrade-interest, GET /samples/:file
│   │   └── helpers.js     findSheet(), sheetPayload(), overview(), loadOwned()
│   │
│   └── services/
│       ├── excel.service.js    parseWorkbook(), reparseSheet(), buildExport(), sheetToCsv()
│       ├── schema.service.js   inferColumn(), applySchemaUpdate(), coerceValue()
│       ├── chart.service.js    computeChart(), suggestCharts(), kpis(), qualityOf()
│       ├── workspace.service.js read(), mutate(), undo(), create(), destroy(), cleanup()
│       ├── samples.js          buildWorkbook() — generates fictional .xlsx for demo/tests
│       ├── logger.js           Structured JSON logger
│       └── util.js             newId(), humanize(), dateToStored(), fmtNum(), …
│
├── public/
│   ├── index.html         Landing page
│   ├── app.html           Workspace shell (single-page app)
│   ├── pricing.html
│   ├── privacy.html
│   ├── styles.css         Single CSS file, no build step
│   └── js/
│       ├── common.js      Shared helpers (S2A namespace: $, $$, h, api, toast, icon)
│       ├── app.js         Workspace controller — state, edits, save, undo, tab routing
│       ├── forms.js       Dynamic form renderer + field validators
│       ├── tables.js      Data table — search, sort, pagination, inline edit
│       ├── charts.js      ECharts integration — render, configure, explain
│       ├── editor.js      Field configuration panel
│       ├── landing.js     Landing page interactions
│       ├── pricing.js     Pricing page
│       └── privacy.js     Privacy page
│
├── tests/
│   ├── helpers.js         startServer() + Client class (cookie-aware HTTP)
│   ├── upload.test.js     Milestone 2 — upload, parsing, validation
│   ├── schema.test.js     Milestone 4 — field editor
│   ├── records.test.js    Milestone 5 — CRUD, undo, persistence
│   ├── export.test.js     Milestone 6 — Excel + CSV export
│   ├── insights.test.js   Milestone 7 — charts, KPIs, recalculation
│   └── security.test.js   Milestone 8 — isolation, CSRF, path traversal
│
├── scripts/
│   └── generate-samples.js   Writes sample .xlsx to samples/
│
└── storage/
    └── workspaces/            Created at runtime (gitignored)
```

---

## Data Model

### Workspace state (`state.json`)

```json
{
  "id": "a3f1...",
  "revision": 7,
  "fileName": "employees.xlsx",
  "createdAt": 1700000000000,
  "savedAt":   1700000500000,
  "saves": 6,
  "sheets": [ <Sheet> ]
}
```

### Sheet

```json
{
  "id": "s1",
  "excelId": 1,
  "name": "Employees",
  "empty": false,
  "headerRow": 1,
  "firstCol": 1,
  "srcLastCol": 9,
  "srcLastRow": 25,
  "nextRowNo": 25,
  "nextColNo": 10,
  "columns": [ <Column> ],
  "rows": [ <Row> ],
  "charts": [ <SavedChart> ],
  "notes": [ { "level": "info|warn", "text": "..." } ],
  "stats": { "blankRowsSkipped": 0, "formulaCells": 3, "mergedRanges": 0 }
}
```

### Column

```json
{
  "id": "c1",
  "sourceIndex": 1,
  "header": "Employee ID",
  "originalHeader": "Employee ID",
  "label": "Employee ID",
  "type": "text",
  "helpText": "Unique identifier for the employee.",
  "placeholder": "e.g. EMP-001",
  "required": false,
  "readOnly": false,
  "visible": true,
  "inTable": true,
  "chartable": false,
  "options": [],
  "defaultValue": null,
  "validation": {},
  "displayOrder": 0,
  "isNew": false,
  "dateNative": false,
  "numFmt": null
}
```

**Supported types:** `text`, `textarea`, `integer`, `decimal`, `currency`, `date`, `datetime`, `boolean`, `dropdown`, `searchable`, `email`, `url`, `phone`, `readonly`

### Row

```json
{
  "id": "r1",
  "src": 2,
  "v": { "c1": "0001", "c2": "Aarav Sharma", "c3": "Engineering" },
  "f": { "c6": { "formula": "D2*E2", "result": 75000 } },
  "h": { "c8": "https://example.com" }
}
```

- `src` — original Excel row number (null for added records)
- `v` — cell values keyed by column ID
- `f` — formula cells (optional)
- `h` — hyperlinks (optional)

---

## API Reference

All API routes are under `/api`. Every mutating route requires the header `x-requested-with: Sheet2App` (CSRF guard).

### Upload

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/workbooks/upload` | Upload `.xlsx` (multipart `file` field) → returns overview |
| `POST` | `/api/workbooks/sample` | Open a named sample (`{ name: "demo" }`) → returns overview |

**Overview response:**

```json
{
  "id": "a3f1...",
  "revision": 1,
  "fileName": "employees.xlsx",
  "sheets": [
    { "id": "s1", "name": "Employees", "records": 24, "columns": 9, "empty": false }
  ]
}
```

### Workbooks

| Method | Path | Description |
|--------|------|-------------|
| `GET`    | `/api/workbooks` | List all workbooks owned by this session |
| `GET`    | `/api/workbooks/:id` | Get workbook overview + undo info |
| `GET`    | `/api/workbooks/:id/sheets/:sheetId` | Get full sheet (columns + rows) |
| `DELETE` | `/api/workbooks/:id` | Delete workspace |
| `POST`   | `/api/workbooks/:id/sheets/:sheetId/header-row` | Re-parse with a different header row `{ headerRow, baseRevision }` |
| `POST`   | `/api/workbooks/:id/undo` | Undo the last save |

### Records (submit)

`POST /api/workbooks/:id/sheets/:sheetId/submit`

```json
{
  "baseRevision": 3,
  "changes": [
    { "op": "add",    "tempId": "tmp1", "values": { "c1": "9999", "c2": "New Person" } },
    { "op": "update", "id": "r4",       "values": { "c2": "Updated Name" } },
    { "op": "delete", "id": "r7" }
  ]
}
```

Returns: `{ summary, created, sheet, revision, undo }`

**Validation errors** → `422` with `fieldErrors` map `{ "r4": { "c2": "Too long." } }`  
**Stale revision** → `409 STALE`  
**Plan limit** → `402 PLAN_LIMIT` with `{ upgrade: true, limit, max }`

### Schema

`PUT /api/workbooks/:id/sheets/:sheetId/schema`

```json
{
  "baseRevision": 4,
  "columns": [ <Column>, ... ],
  "confirmDelete": ["c3"]
}
```

If a column is removed without its ID in `confirmDelete` → `409 DELETE_NOT_CONFIRMED`

### Insights

| Method | Path | Description |
|--------|------|-------------|
| `GET`    | `/api/workbooks/:id/sheets/:sheetId/insights` | KPIs, auto charts, saved charts, chart options |
| `POST`   | `/api/workbooks/:id/sheets/:sheetId/charts/preview` | Preview a chart config (not saved) |
| `POST`   | `/api/workbooks/:id/sheets/:sheetId/charts` | Save a custom chart `{ chartId?, config }` |
| `DELETE` | `/api/workbooks/:id/sheets/:sheetId/charts/:chartId` | Delete a saved chart |

**Chart config:**

```json
{
  "type": "bar",
  "dimension": "c3",
  "measure": "c5",
  "agg": "sum",
  "filters": [],
  "sort": "desc",
  "title": "Salary by Department"
}
```

**Supported types:** `bar`, `hbar`, `line`, `area`, `pie`, `doughnut`, `stacked`, `histogram`, `scatter`, `box`  
**Aggregations:** `count`, `sum`, `avg`, `min`, `max`

### Export

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/workbooks/:id/export.xlsx` | Download updated workbook |
| `GET` | `/api/workbooks/:id/sheets/:sheetId/export.csv` | Download sheet as CSV |

### Meta

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/health` | `{ ok: true }` |
| `GET`  | `/api/config` | Plans, limits, active plan, currency |
| `POST` | `/api/upgrade-interest` | `{ plan }` → checkout URL or waitlist message |
| `GET`  | `/api/samples/:file` | Download a sample `.xlsx` (`demo.xlsx`, `employees.xlsx`, etc.) |

---

## Key Services

### `excel.service.js`

- **`parseWorkbook(buffer, limits)`** — validates signature, reads every worksheet, returns `{ sheets }` ready for the state model. Detects header row, handles blank/duplicate headers, preserves formulas and hyperlinks.
- **`reparseSheet(buffer, sheet, headerRow, limits)`** — re-read one sheet with a different header row.
- **`buildExport(originalBuffer, state)`** — opens the original workbook and writes the latest saved state back into it. Preserves column widths, styles, freeze panes, formulas, hyperlinks and autofilter.
- **`sheetToCsv(sheet)`** — produces RFC 4180 CSV with BOM, formula-injection-safe.
- **`validateXlsxBuffer(buffer)`** — checks PK magic, rejects OLE2 (`.xls`), macros, oversized zip bombs.

### `schema.service.js`

- **`inferColumn(header, values, { formulaCount })`** — analyses header name + sample values to suggest a field type. Uses keyword lists, regex patterns, unique-value counts and boolean detection.
- **`applySchemaUpdate(sheet, payload, { maxColumns })`** — validates and applies a full column array replacement. Handles add / rename / reorder / delete (with confirmation). Returns `{ added, removed, renamedHeaders }`.
- **`coerceValue(col, raw)`** — converts and validates a raw input value against the column type. Returns `{ value }` or `{ error }`.
- **`sameValue(a, b)`** — deep equality for stored values (used to skip no-op updates).

### `chart.service.js`

- **`suggestCharts(sheet, { maxCharts })`** — classifies columns into categories/numbers/dates, builds candidate configs, probes each one with `computeChart`, returns `{ configs, skipped, locked }`.
- **`computeChart(sheet, cfg)`** — calculates chart data from saved rows. Applies filters, aggregates, sorts groups, builds the full result including `explain { what, howToRead, pattern, limitations }` and `meaning`.
- **`kpis(sheet)`** — returns summary cards: record count, column count, completeness %, totals/averages for currency columns.
- **`qualityOf(sheet)`** — returns `{ score, label, blankCells, dupRows }`.

### `workspace.service.js`

- **`create(sid, fileName, buffer, parsed, plan)`** — creates a new workspace directory, writes `original.xlsx`, `state.json`, `undo.json`, `meta.json`. Sets owner to `sha256(sid)`.
- **`read(id, sid)`** — authorizes + loads state from cache (5-min TTL) or disk.
- **`mutate(id, sid, { baseRevision, undoLabel, sheetId }, fn)`** — acquires a per-workspace lock, deep-clones current state, calls `fn(draft)`, increments revision, writes atomically, updates cache.
- **`undo(id, sid)`** — pops the most recent undo snapshot and writes it as the new state.
- **`startCleanupTimer()`** — runs every `CLEANUP_INTERVAL_MINUTES`, deletes workspaces past their `expiresAt`.

---

## Frontend Modules

All JavaScript is plain ES5-compatible vanilla JS in an IIFE pattern. The `window.S2A` namespace is set up by `common.js`.

```
common.js   → S2A.$(), S2A.$$(), S2A.h(), S2A.api(), S2A.toast(), S2A.icon()
app.js      → state machine, tab routing, unsaved-edit tracking, save/undo/download
forms.js    → dynamic form render from column schema, field validators, add/edit record modal
tables.js   → data table, search, sort, pagination, inline state badges
charts.js   → ECharts wrapper, config builder UI, explain panel, chart CRUD
editor.js   → field configuration panel (drag-reorder, type picker, options editor)
```

**State flow (app.js):**

```
upload / demo → state.wb loaded → sheetId set → tab renders
  edits tracked in state.edits[sheetId].map{ key → {values, deleted, isNew} }
  Save → POST /submit → clears edits → refreshes table/form/charts
  Undo → POST /undo  → replaces current sheet state
  Tab switch → unsaved-change warning if hasEdits()
```

**API helper (`common.js` `api`):**

```js
const r = await S2A.api('POST', '/workbooks/id/sheets/s1/submit', { body });
// Handles: x-requested-with header, JSON stringify/parse, error toasts, 402 upgrade prompt
```

---

## Security Model

| Layer | Mechanism |
|-------|-----------|
| Network binding | `HOST=127.0.0.1` — never binds to `0.0.0.0` |
| Transport | TLS terminated externally; `COOKIE_SECURE=true` when behind HTTPS proxy |
| Session | `HttpOnly; SameSite=Strict; Max-Age=30d` anonymous cookie, `crypto.randomBytes(24)` |
| CSRF | Double-submit: `x-requested-with: Sheet2App` required on all mutations + Origin vs Host check |
| Ownership | Workspace `meta.owner = sha256(sid)` — wrong session always gets 404 (no timing leak) |
| Path traversal | `WORKSPACE_ID_RE = /^[a-f0-9]{32}$/` + `path.resolve` parent check |
| File validation | Signature check (PK magic), OLE2 / macro detection, zip-bomb guard (400 MB uncompressed), MIME + extension |
| Safe filenames | `safeFileName()` strips non-ASCII, limits to 100 chars |
| Atomic writes | `tmp → fsync → rename` prevents corrupt state.json on crash |
| Rate limiting | 600 req/min global; 30 req/10min on upload/export |
| CSP | `script-src 'self'` — no inline scripts, no CDN |
| Input validation | All record values pass through `coerceValue()`; schema updates validated server-side |
| Error messages | Generic messages to client; full detail logged server-side only |

---

## Plans and Feature Limits

Defined in [`src/config/plans.js`](src/config/plans.js). Active plan is set by the `PLAN` env var.

```js
effectiveLimits()  // returns plan limits capped by deployment-wide env caps
```

Limits enforced at runtime:

| Limit key | Where enforced |
|-----------|---------------|
| `maxUploadMB` | Multer `fileSize` |
| `maxSheets` | `parseWorkbook` |
| `maxRowsPerSheet` | `submit` handler |
| `maxColumns` | `applySchemaUpdate` |
| `workspaces` | `upload` handler |
| `autoCharts` | `suggestCharts` |
| `customCharts` | `POST /charts` |

Plan-limit errors return `402` with `{ upgrade: true, limit, max }` — the frontend shows an upgrade prompt.

---

## Testing

```bash
npm test          # run all 58 tests
```

Tests use Node's built-in `node:test` runner — no extra test framework needed.

Each test file spins up a **real HTTP server on a random port** with an isolated temp storage directory. The `Client` class in `tests/helpers.js` is a cookie-aware fetch wrapper.

| File | Tests | What it covers |
|------|-------|----------------|
| `upload.test.js` | 7 | Parsing, field type inference, messy sheets, validation |
| `schema.test.js` | 8 | Field editor — rename, add, delete, reorder, type change |
| `records.test.js` | 9 | Add, edit, delete, validation, optimistic lock, undo, persistence |
| `export.test.js` | 8 | Excel + CSV — edited values, added/deleted rows and columns |
| `insights.test.js` | 12 | KPIs, auto charts, chart correctness, recalculation, explain |
| `security.test.js` | 13 | Session isolation, CSRF, path traversal, health, samples |

---

## Adding a New Feature

### New API route

1. Add a handler in the appropriate `src/routes/*.js` file (or create a new one).
2. Register it in `app.js` under the `api` router.
3. Use `loadOwned(req)` + `findSheet()` for workspace access — never trust client-provided paths.
4. Wrap mutations in `workspace.mutate()` for atomicity + undo support.
5. Add tests in `tests/`.

### New field type

1. Add the type string to `TYPES` in `src/services/schema.service.js`.
2. Add validation logic in `coerceValue()`.
3. Add inference rules in `inferColumn()`.
4. Add a `TYPE_INFO` entry (label, icon, numeric flag).
5. Handle it in `forms.js` (render the correct input element).
6. Handle it in `excel.service.js` `cellValueFor()` (export formatting).

### New chart type

1. Add the type key to `CHART_TYPES` in `src/services/chart.service.js`.
2. Add a `CHART_LABEL` entry.
3. Write a `buildXxx()` function and add it to `computeChart()`'s dispatch.
4. Add to `suggestCharts()` if it should be auto-suggested.
5. Handle it in `public/js/charts.js` (ECharts option builder).

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP port |
| `HOST` | `127.0.0.1` | Bind address — never use `0.0.0.0` in production |
| `NODE_ENV` | `development` | Set to `production` for tighter security headers |
| `MAX_UPLOAD_MB` | `10` | Hard cap on upload size (overrides plan limit) |
| `MAX_SHEETS` | `30` | Max worksheets per workbook |
| `MAX_ROWS_PER_SHEET` | `50000` | Max rows per sheet |
| `WORKSPACE_TTL_HOURS` | `24` | Hours before a workspace auto-expires |
| `CLEANUP_INTERVAL_MINUTES` | `30` | How often the cleanup timer runs |
| `PLAN` | `free` | Active plan: `free`, `pro`, `business` |
| `TRUST_PROXY` | `false` | Set `true` behind a reverse proxy (enables `X-Forwarded-*`) |
| `COOKIE_SECURE` | `false` | Set `true` when served over HTTPS |
| `STORAGE_DIR` | `./storage` | Absolute or relative path for workspace storage |
| `CURRENCY_SYMBOL` | `₹` | Symbol used in chart number formatting |
| `BILLING_PROVIDER` | — | Optional: billing provider name |
| `BILLING_CHECKOUT_URL` | — | Optional: HTTPS checkout URL for upgrade flow |

---

## Known Limitations

- **No multi-user collaboration** — workspaces are bound to one browser session
- **No formula recalculation** — exported formulas are preserved but results update only in Excel/Sheets
- **Merged cells** — ranges overlapping the data table are split on export
- **Excel Tables** — removed from export (data is kept); range tracking is incompatible with edits
- **`.xls` files** — not supported; save as `.xlsx` in Excel first
- **Macro workbooks** — rejected; save as plain `.xlsx`
- **JSON concurrency** — suitable for single-user local use; not a database replacement for concurrent writes
