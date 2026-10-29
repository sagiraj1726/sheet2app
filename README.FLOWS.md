# Sheet2App — Functionality Reference & Flow Diagrams

This document explains every feature of Sheet2App with flow diagrams, so any user or developer can understand exactly what happens at each step.

---

## Table of Contents

1. [Complete user journey](#1-complete-user-journey)
2. [Upload & parsing flow](#2-upload--parsing-flow)
3. [Field type detection](#3-field-type-detection)
4. [Data table & search](#4-data-table--search)
5. [Record editing (forms)](#5-record-editing-forms)
6. [Field configuration editor](#6-field-configuration-editor)
7. [Submit & save flow](#7-submit--save-flow)
8. [Undo](#8-undo)
9. [Charts & insights](#9-charts--insights)
10. [Excel export](#10-excel-export)
11. [Workspace lifecycle](#11-workspace-lifecycle)
12. [Security checks on every request](#12-security-checks-on-every-request)
13. [Plan limits & upgrade flow](#13-plan-limits--upgrade-flow)
14. [All features at a glance](#14-all-features-at-a-glance)

---

## 1. Complete User Journey

```
┌─────────────────────────────────────────────────────────────────┐
│                     SHEET2APP  USER JOURNEY                     │
└─────────────────────────────────────────────────────────────────┘

  Landing page
       │
       ├─── Drop .xlsx file ───────────────────────┐
       │                                           │
       └─── Click a sample (Inventory, etc.) ──────┤
                                                   │
                                                   ▼
                                         ┌─────────────────┐
                                         │  Upload & Parse  │
                                         │  Every worksheet │
                                         │  is read once.   │
                                         └────────┬────────┘
                                                  │
                                                  ▼
                                         ┌─────────────────┐
                                         │   Workspace      │
                                         │   created with   │
                                         │   unique ID      │
                                         └────────┬────────┘
                                                  │
                              ┌───────────────────┼───────────────────┐
                              │                   │                   │
                              ▼                   ▼                   ▼
                       ┌────────────┐     ┌────────────┐     ┌────────────┐
                       │  Overview  │     │ Data Table │     │    Form    │
                       │  KPI cards │     │ Search /   │     │ Add / Edit │
                       │  quality   │     │ Sort / Page│     │ records    │
                       └────────────┘     └────────────┘     └────────────┘
                              │                   │                   │
                              └───────────────────┴───────────────────┘
                                                  │
                              ┌───────────────────┼───────────────────┐
                              │                   │                   │
                              ▼                   ▼                   ▼
                       ┌────────────┐     ┌────────────┐     ┌────────────┐
                       │   Fields   │     │  Insights  │     │  Download  │
                       │ Configure  │     │  Charts +  │     │  Updated   │
                       │ field types│     │  Explain   │     │  .xlsx     │
                       └────────────┘     └────────────┘     └────────────┘
```

---

## 2. Upload & Parsing Flow

```
User drops / selects a .xlsx file
         │
         ▼
┌─────────────────────────────┐
│  Multer: file size check     │
│  Extension must be .xlsx     │◄── STOP if .xls → friendly message
│  MIME type must be allowed   │◄── STOP if wrong type
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│  Signature check (first 4B) │
│  PK magic: 50 4B 03 04      │◄── STOP if OLE2 (old .xls)
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│  Open with JSZip             │
│  Check [Content_Types].xml   │◄── STOP if not a real xlsx
│  Check xl/workbook.xml       │◄── STOP if zip only
│  Reject vbaProject.bin       │◄── STOP if macros present
│  Measure uncompressed size   │◄── STOP if > 400 MB
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│  ExcelJS reads every sheet   │
│  For each worksheet:         │
│    • Detect header row       │
│      (scan first 20 rows,    │
│       pick row with most     │
│       non-numeric strings)   │
│    • Extract column names    │
│    • Handle duplicates       │
│      → append " (2)", " (3)" │
│    • Handle blank headers    │
│      → "Column A", "Column B"│
│    • Read all data rows      │
│    • Skip completely blank   │
│      rows                    │
│    • Preserve formulas,      │
│      hyperlinks, dates       │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│  schema.inferColumn()        │
│  for every column:           │
│    analyse header name +     │
│    sample values → suggest   │
│    field type                │
│  (see Section 3)             │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│  workspace.create()          │
│  Write to disk:              │
│    original.xlsx             │
│    state.json  (atomic)      │
│    undo.json   []            │
│    meta.json                 │
└──────────────┬──────────────┘
               │
               ▼
         201 Created
     Overview JSON returned
     Browser redirects to /app
```

---

## 3. Field Type Detection

For each column, `schema.inferColumn()` examines the header name and up to 5,000 sample values:

```
                    FIELD TYPE DECISION TREE
                    
Column header + sample values
         │
         ├─── Formula-only column?  ──────────────────► readonly
         │
         ├─── Header contains: id, code, no., ref,
         │    phone, mobile, pin, zip, postal,
         │    survey, account, aadhaar, pan  ──────────► text
         │    (preserves leading zeros)
         │
         ├─── Header contains: email  ────────────────► email
         │
         ├─── Header contains: url, website, link  ──► url
         │
         ├─── Header contains: date, dob, joined,
         │    due, expiry  ─────────────────────────────► date
         │
         ├─── Header contains: note, description,
         │    remarks, comment, summary  ──────────────► textarea
         │
         ├─── Header contains: active, is_, has_,
         │    enabled, flag  ──────────────────────────► boolean
         │         OR all values are Yes/No, True/False
         │
         ├─── All values are integers  ────────────────► integer
         │
         ├─── All values are decimal  ─────────────────► decimal
         │
         ├─── Header contains: salary, amount,
         │    revenue, price, cost, budget, fee  ───────► currency
         │
         ├─── Values look like dates  ─────────────────► date or datetime
         │
         ├─── Unique value count is low (≤ 30)
         │    and repeating (like "HR, IT, Sales")  ──► dropdown
         │
         └─── Everything else  ────────────────────────► text
```

**Important:** inferred types are always suggestions. Users can override every field type in the Fields tab.

---

## 4. Data Table & Search

```
Sheet selector (top)
       │
       ▼
┌──────────────────────────────────────────┐
│  SEARCH  [________________]  + Add record │
│                                          │
│  Col A ↑  Col B    Col C    Col D  ...   │
│  ─────────────────────────────────────── │
│  val 1    val 2    val 3    val 4  [✏️][🗑]│
│  val 5    val 6    val 7    val 8  [✏️][🗑]│
│  ...                                     │
│                                          │
│  [← Prev]  Page 1 of 3  [Next →]        │
└──────────────────────────────────────────┘
       │
       ├── Search box ──► filters all rows client-side (all columns)
       │
       ├── Column header click ──► toggles ascending / descending sort
       │
       ├── Pagination ──► 50 rows per page
       │
       ├── ✏️ Edit ──► opens Form view for that record
       │
       └── 🗑 Delete ──► confirmation dialog → marks record deleted
                         (not yet saved until Submit is clicked)
```

**Row states shown visually:**
- Default = saved (white background)
- Edited = amber highlight
- New (not yet submitted) = green highlight
- Deleted (not yet submitted) = strikethrough + red

---

## 5. Record Editing (Forms)

```
User clicks "Add record" or "Edit"
         │
         ▼
┌─────────────────────────────────────────┐
│              FORM VIEW                  │
│                                         │
│  Employee Name *                        │
│  ┌─────────────────────────┐            │
│  │ Aarav Sharma            │            │
│  └─────────────────────────┘            │
│  Full name of the employee              │← help text
│                                         │
│  Department                             │
│  ┌──────────────┐                       │
│  │ Engineering ▼│                       │← dropdown (inferred)
│  └──────────────┘                       │
│                                         │
│  Joining Date                           │
│  ┌──────────────┐                       │
│  │ 2023-06-15   │                       │← date picker
│  └──────────────┘                       │
│                                         │
│  Is Active                              │
│  ☑ Yes / No                            │← checkbox
│                                         │
│  Notes                                  │
│  ┌─────────────────────────────────┐    │
│  │                                 │    │
│  └─────────────────────────────────┘    │← textarea
│                                         │
│  [Cancel]          [Save Changes]       │
└─────────────────────────────────────────┘

Each field type renders a different input:
  text      → <input type="text">
  integer   → <input type="number" step="1">
  decimal   → <input type="number" step="any">
  currency  → <input type="number"> with symbol prefix
  date      → <input type="date">
  datetime  → <input type="datetime-local">
  boolean   → <input type="checkbox">
  dropdown  → <select> with options from schema
  searchable→ <input> with datalist
  email     → <input type="email">
  url       → <input type="url">
  phone     → <input type="tel">
  textarea  → <textarea>
  readonly  → <span> (display only, not editable)
```

**Validation happens client-side (immediate feedback) and server-side (on submit):**
- Required fields must not be blank
- Email must match pattern
- URL must start with `https://`
- Number fields reject non-numeric input
- Dropdown must pick from listed options
- Text max 32,767 characters (Excel limit)

---

## 6. Field Configuration Editor

```
User clicks "Fields" tab
         │
         ▼
┌────────────────────────────────────────────────────────┐
│  FIELD CONFIGURATION                                    │
│                                                        │
│  ⠿  Employee ID      [text     ▼]  [👁]  [⚙️]          │
│  ⠿  Employee Name    [text     ▼]  [👁]  [⚙️]          │
│  ⠿  Department       [dropdown ▼]  [👁]  [⚙️]          │
│  ⠿  Joining Date     [date     ▼]  [👁]  [⚙️]          │
│  ⠿  Salary           [currency ▼]  [👁]  [⚙️]          │
│  ...                                                   │
│                                                        │
│                              [+ Add column]            │
└────────────────────────────────────────────────────────┘
         │
         │  Click ⚙️ on a column
         ▼
┌────────────────────────────────────────────────────────┐
│  EDIT COLUMN: Department                               │
│                                                        │
│  Display label   [Division              ]              │
│  Excel header    [Department            ]  (separate!) │
│  Field type      [dropdown              ▼]             │
│  Help text       [Choose the team/dept  ]              │
│  Placeholder     [Select a department   ]              │
│  Required        [☑]                                   │
│  Visible in form [☑]                                   │
│  Show in table   [☑]                                   │
│  Use in charts   [☑]                                   │
│  Options         [HR, IT, Engineering, Sales     ]     │
│                                                        │
│  [Delete column 🗑]          [Save field settings]     │
└────────────────────────────────────────────────────────┘

IMPORTANT DISTINCTION:
  Display label  = what users see in the form and table UI
  Excel header   = the actual column name in the .xlsx file
  Changing label only → no impact on exported workbook header
  Changing Excel header → exported workbook uses the new name

DELETE COLUMN FLOW:
  Click Delete → confirmation dialog shows:
  "This will permanently remove 'Department' and ALL its data
   from the exported workbook. This cannot be undone."
  [Cancel] [Yes, delete column]
  → Only deleted after explicit confirmation
```

**Reorder columns:**  
Drag the ⠿ handle to reorder. Order is immediately reflected in the form, table and exported workbook.

---

## 7. Submit & Save Flow

```
User makes edits (add / update / delete records, or field config changes)
         │
         │  Unsaved indicator appears in header:
         │  "3 unsaved changes"
         │
User clicks [Save Changes]
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│  CLIENT-SIDE  (immediate, before network request)       │
│  • Required field check                                 │
│  • Format validation (email, url, number ranges)        │
│  • Mark fields with inline error messages               │
│  • Block submit if any errors found                     │
└──────────────────────────┬──────────────────────────────┘
                           │  No client errors
                           ▼
                  POST /submit with:
                  { baseRevision, changes: [...] }
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│  SERVER-SIDE                                            │
│                                                        │
│  1. Verify baseRevision matches current revision       │
│     → 409 STALE if changed in another tab              │
│                                                        │
│  2. Verify workspace ownership (session check)         │
│     → 404 if wrong session                             │
│                                                        │
│  3. For each change:                                   │
│     • "add"    → validate all field values             │
│     • "update" → validate changed values               │
│     • "delete" → verify record exists                  │
│     • read-only fields → reject if value changed       │
│                                                        │
│  4. If ANY field fails validation →                    │
│     422 with fieldErrors map                           │
│     → NOTHING is saved (all-or-nothing)                │
│                                                        │
│  5. Check plan row limit                               │
│     → 402 PLAN_LIMIT if exceeded                       │
│                                                        │
│  6. Apply all changes to draft state                   │
│                                                        │
│  7. Increment revision                                 │
│                                                        │
│  8. Save undo snapshot (before this save)              │
│                                                        │
│  9. Atomic write: tmp → fsync → rename state.json      │
│                                                        │
│  10. Update in-memory cache                            │
└──────────────────────────┬──────────────────────────────┘
                           │  200 OK
                           ▼
                  ┌─────────────────┐
                  │ Success toast   │
                  │ Table refreshed │
                  │ Form refreshed  │
                  │ Charts refresh  │
                  │ Undo available  │
                  └─────────────────┘
```

**Switching sheets with unsaved changes:**
```
User clicks a different sheet tab
         │
         ▼
  Do any sheets have unsaved edits?
         │
    Yes  │  No
         │   └──► Switch immediately
         ▼
  Dialog: "You have 2 unsaved changes in 'Employees'.
           Switch anyway and lose them?"
  [Stay]   [Switch and discard]
```

---

## 8. Undo

```
Every successful Submit creates one undo snapshot
(up to 8 snapshots stored, oldest dropped when full)

  Undo button shows: "Undo: Save changes"
         │
  User clicks Undo
         │
         ▼
  Server pops the most recent snapshot
  Writes it as the new state.json
  Returns the restored sheet state
         │
         ▼
  Table + form refresh to show previous data
  Undo button updates to show next available action
  (or disappears if nothing left to undo)

NOTE: Undo only covers record edits and schema changes
      made through Sheet2App. The original uploaded file
      is always kept and can be re-parsed at any time.
```

---

## 9. Charts & Insights

```
User clicks "Insights" tab  →  Enable Insights toggle [ON]
         │
         ▼
GET /insights
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│  KPI CARDS (always shown)                               │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│  │ 24       │ │ 9        │ │ 97%      │ │ ₹18.2 L  │  │
│  │ Records  │ │ Columns  │ │ Complete │ │ TotalSal │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘  │
└─────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│  DATA QUALITY SCORE                                     │
│  ████████████░░░  87/100  "Good"                        │
│  3 blank cells · 0 duplicate rows                       │
└─────────────────────────────────────────────────────────┘
         │
         ▼
suggestCharts() analyses columns:
  ┌──────────────────────────────────────────────────────┐
  │  Classify each column:                               │
  │    category → columns with ≤ 40 unique repeat values │
  │    number   → integer, decimal, currency columns     │
  │    date     → date, datetime columns                 │
  └──────────────────────────────────────────────────────┘
         │
         ├─── No categories → skip bar/pie charts, explain why
         ├─── No numbers    → skip histograms/scatter, explain why
         └─── No dates      → skip line/area charts, explain why
         │
         ▼  (for each suggested chart)
  computeChart() runs on actual saved data:
    1. Apply filters
    2. Group by dimension
    3. Aggregate (count / sum / avg / min / max)
    4. Sort groups
    5. Build series data
    6. Generate explain { what, howToRead, pattern, limitations }
    7. Generate meaning (deterministic sentences from real numbers)
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│  AUTO CHARTS (up to 6 on Free plan)                     │
│                                                         │
│  ┌─────────────────────────┐  ┌──────────────────────┐ │
│  │  Count by Department    │  │  Salary by Dept      │ │
│  │  [bar chart]            │  │  [bar chart]         │ │
│  │  🛈 Explain this chart  │  │  🛈 Explain          │ │
│  └─────────────────────────┘  └──────────────────────┘ │
│                                                         │
│  ┌─────────────────────────┐  ┌──────────────────────┐ │
│  │  Salary Distribution    │  │  Active vs Inactive  │ │
│  │  [histogram]            │  │  [doughnut]          │ │
│  │  🛈 Explain this chart  │  │  🛈 Explain          │ │
│  └─────────────────────────┘  └──────────────────────┘ │
└─────────────────────────────────────────────────────────┘
         │
         │  Click "🛈 Explain this chart"
         ▼
┌─────────────────────────────────────────────────────────┐
│  EXPLANATION PANEL                                      │
│                                                         │
│  What this chart shows:                                 │
│  "This bar chart shows the count of records for         │
│   each 'Department'."                                   │
│                                                         │
│  How to read it:                                        │
│  "Each bar is one 'Department' value. The taller the    │
│   bar, the higher the count. Hover a bar for the        │
│   exact figure."                                        │
│                                                         │
│  What does this mean?                                   │
│  "'Engineering' is the largest with 8 (33.3% of the    │
│   total 24). The smallest is 'Finance' with 3.          │
│   'Engineering' is 2.7 times 'HR', the second           │
│   largest. These figures describe what is in your       │
│   sheet; they do not explain why the differences exist."│
│                                                         │
│  Limitations:  (none)                                   │
└─────────────────────────────────────────────────────────┘
         │
         │  User clicks "+ Add custom chart"
         ▼
┌─────────────────────────────────────────────────────────┐
│  CHART BUILDER                                          │
│  Chart type   [Bar chart        ▼]                      │
│  Category     [Department       ▼]                      │
│  Measure      [Salary           ▼]  (optional)          │
│  Aggregation  [Sum              ▼]                      │
│  Sort         [Highest first    ▼]                      │
│  Filter       [+ Add filter]                            │
│  Title        [Salary by Department]                    │
│                                                         │
│  [Preview]                        [Save chart]          │
└─────────────────────────────────────────────────────────┘

SUPPORTED CHART TYPES:
  bar        → vertical bars, compare categories
  hbar       → horizontal bars, long category names
  line       → trend over time
  area       → filled line, good for totals over time
  pie        → shares of a whole (up to 12 slices)
  doughnut   → same as pie with centre label
  stacked    → stacked bars, breakdown by two categories
  histogram  → distribution of a numeric column
  scatter    → relationship between two numeric columns
  box        → spread of a numeric column by category
```

---

## 10. Excel Export

```
User clicks "Download Updated Excel"
         │
         ▼
GET /export.xlsx
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│  Load ORIGINAL uploaded workbook bytes                  │
│  (never the in-memory state — preserves all styles)     │
└──────────────────────────┬──────────────────────────────┘
                           │
                           ▼
               For EACH worksheet in the workbook:
┌─────────────────────────────────────────────────────────┐
│  1. Find the worksheet by Excel sheet ID                │
│                                                         │
│  2. Un-merge any merged cells that overlap              │
│     the data table (data is kept, merge is removed)     │
│                                                         │
│  3. Snapshot all existing column widths + header styles │
│                                                         │
│  4. Clear the old table area (header + data rows)       │
│                                                         │
│  5. Write headers from current schema                   │
│     → uses updated column names                         │
│     → preserves original header styles                  │
│     → updates column widths                             │
│                                                         │
│  6. Write all current records row by row                │
│     → edits applied                                     │
│     → added records appended                            │
│     → deleted records absent                            │
│     → formula cells preserved as formulas               │
│     → hyperlinks preserved                              │
│     → date/number formatting applied                    │
│                                                         │
│  7. Recreate dropdown data validations                  │
│     for dropdown-type columns                           │
│                                                         │
│  8. Update AutoFilter range                             │
└──────────────────────────┬──────────────────────────────┘
                           │
                           ▼
              ExcelJS writes the modified workbook
              to a Buffer (never to disk for export)
                           │
                           ▼
              Browser downloads:
              "yourfile-updated.xlsx"

WHAT IS PRESERVED:
  ✓ Worksheets not in the data area (title rows, summary sheets)
  ✓ Column widths and header styling
  ✓ Formulas (result is updated if you edited the cell)
  ✓ Hyperlinks
  ✓ Freeze panes
  ✓ AutoFilter
  ✓ Sheet names and order

WHAT CHANGES:
  • Merged cells overlapping the table → split
  • Excel Table objects → removed (data stays)
  • Added records appear as plain rows
  • Deleted records are absent

WHAT IS NOT SUPPORTED:
  • Macro recalculation
  • Chart objects inside the workbook
  • Pivot tables
```

---

## 11. Workspace Lifecycle

```
  Upload
    │
    ▼
  workspace created
  expiresAt = now + 24h
  owner = sha256(sessionId)
    │
    │  Every access ──────────────────────────────────────────────┐
    │  (read or write)                                            │
    │  touches expiresAt → extends by 24h                        │
    │  (workspace stays alive while user is active)              │
    │                                                             │
    ├─── User edits and saves → revision++                       │
    │                                                             │
    ├─── User clicks Delete workspace → immediate removal        │
    │                                                             │
    └─── No access for 24h                                       │
                  │                                               │
                  ▼ (every 30 minutes)                            │
           Cleanup timer runs                                     │
           Scans all workspaces                                   │
           Deletes expired ones                                   │
           (original.xlsx + state + undo + meta all removed)     │
                                                                  │
    ◄─────────────────────────────────────────────────────────────┘

STORAGE LAYOUT:
  storage/workspaces/
    a3f1b2c4.../        ← 32 hex char workspace ID
      original.xlsx     ← never modified after upload
      state.json        ← current state (atomic write)
      state.json.bak    ← previous state (recovery)
      undo.json         ← up to 8 undo snapshots
      meta.json         ← owner, timestamps, expiry
```

---

## 12. Security Checks on Every Request

```
Incoming HTTP request
         │
         ▼
┌────────────────────────────┐
│  Helmet (CSP, HSTS, etc.)  │
└──────────────┬─────────────┘
               │
               ▼
┌────────────────────────────┐
│  Rate limiter              │
│  600 req/min (global)      │
│  30 req/10min (upload)     │
└──────────────┬─────────────┘
               │
               ▼
┌────────────────────────────┐
│  Session cookie            │
│  Read or issue new cookie  │
│  (HttpOnly, SameSite=Strict│
│   32-char base64url ID)    │
└──────────────┬─────────────┘
               │
               ▼
┌────────────────────────────┐   Mutating request?
│  CSRF guard                │──(POST/PUT/DELETE)──►
│  x-requested-with required │   Missing header → 403
│  Origin must match Host    │   Wrong origin → 403
└──────────────┬─────────────┘
               │
               ▼
Workspace route?
         │
         ▼
┌────────────────────────────┐
│  Workspace ID validation   │
│  Must match /^[a-f0-9]{32}$│◄── Invalid format → 404
│  path.resolve parent check │◄── Traversal attempt → 404
└──────────────┬─────────────┘
               │
               ▼
┌────────────────────────────┐
│  Ownership check           │
│  sha256(session) must match│◄── Wrong session → 404
│  meta.owner                │   (same as not found —
│                            │    no probing leak)
└──────────────┬─────────────┘
               │
               ▼
┌────────────────────────────┐
│  Expiry check              │◄── Expired → 410 EXPIRED
│  meta.expiresAt > now      │    workspace auto-deleted
└──────────────┬─────────────┘
               │
               ▼
         Handler runs
```

---

## 13. Plan Limits & Upgrade Flow

```
Action attempted
         │
         ▼
effectiveLimits() — merges plan limits with deployment env caps
         │
         ▼
Limit exceeded?
         │
    Yes  │  No
         │   └──► Action proceeds normally
         ▼
  402 PLAN_LIMIT response:
  {
    "error": "Your plan allows up to 500 records per sheet.",
    "code": "PLAN_LIMIT",
    "upgrade": true,
    "limit": "maxRowsPerSheet",
    "max": 500
  }
         │
         ▼ (browser)
  Upgrade prompt dialog:
  "Upgrade to Pro to increase the limit."
  [Maybe later]   [See plans →]
         │
  User clicks "See plans"
         │
         ▼
  POST /api/upgrade-interest { plan: "pro" }
         │
    Billing configured?
         │
    Yes  │  No
         │   └──► "Paid plans are not open yet.
         ▼         Thank you for your interest."
  { checkoutUrl: "https://..." }
  → Browser redirects to checkout

PLAN LIMITS AT A GLANCE:
  ┌────────────────┬──────┬────────┬──────────┐
  │ Limit          │ Free │  Pro   │ Business │
  ├────────────────┼──────┼────────┼──────────┤
  │ Upload size    │  5MB │  25MB  │   50MB   │
  │ Worksheets     │    3 │    20  │     50   │
  │ Rows/sheet     │  500 │ 50,000 │  50,000  │
  │ Columns/sheet  │   25 │    200 │    300   │
  │ Workspaces     │    3 │    10  │     25   │
  │ Auto charts    │    6 │    16  │     24   │
  │ Saved charts   │    2 │    20  │     50   │
  └────────────────┴──────┴────────┴──────────┘
```

---

## 14. All Features at a Glance

| Feature | Description | Where |
|---------|-------------|-------|
| **Upload .xlsx** | Drop or choose any Excel workbook | Landing page |
| **Try sample data** | Instant demo with fictional datasets | Landing page |
| **Multi-sheet support** | Every worksheet gets its own tab | Workspace header |
| **Auto field detection** | Columns typed automatically on upload | (automatic) |
| **Searchable data table** | Filter all rows by any value | Data tab |
| **Sort by column** | Click any header to sort | Data tab |
| **Pagination** | 50 rows per page | Data tab |
| **Add record** | Fill a generated form and add a row | Data tab / Form tab |
| **Edit record** | Change any non-readonly field | Data tab / Form tab |
| **Delete record** | Remove a row with confirmation | Data tab |
| **Inline validation** | Errors shown next to fields instantly | Form tab |
| **Rename display label** | Change what users see (not the Excel header) | Fields tab |
| **Rename Excel header** | Change the column name in the export | Fields tab |
| **Change field type** | Override auto-detected type | Fields tab |
| **Add help text** | Hint shown below each field | Fields tab |
| **Add/remove columns** | Add new columns or delete existing ones | Fields tab |
| **Reorder columns** | Drag to change display and export order | Fields tab |
| **Hide/show fields** | Toggle visibility in form and table | Fields tab |
| **Save changes** | All-or-nothing atomic save | Any tab |
| **Undo** | Revert to the previous save | Header |
| **Unsaved-change warning** | Prompted before losing edits | On tab switch |
| **KPI cards** | Record count, completeness, totals | Insights tab |
| **Data quality score** | Blank cells + duplicate detection | Insights tab |
| **Auto chart suggestions** | Up to 6/16/24 charts generated from data | Insights tab |
| **Chart builder** | Create custom charts with any config | Insights tab |
| **Plain-language explain** | Every chart explained in simple English | Insights tab |
| **Save custom charts** | Persist chart configs per worksheet | Insights tab |
| **Download updated Excel** | Export with all edits applied | Header button |
| **Download CSV** | Per-sheet CSV export | Header button |
| **Select header row** | Fix mis-detected header rows | Sheet settings |
| **Delete workspace** | Remove all data immediately | Workspace settings |
| **Auto-expiry** | Workspaces deleted after 24h inactivity | (automatic) |
| **Pricing page** | Plan comparison and upgrade flow | /pricing |
| **Privacy page** | Data handling explanation | /privacy |
| **Health check** | `GET /api/health` for monitoring | API |
| **Sample downloads** | Download sample .xlsx files | `/api/samples/` |
