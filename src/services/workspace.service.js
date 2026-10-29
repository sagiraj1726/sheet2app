'use strict';

/**
 * Temporary, database-free workspaces.
 *
 *   storage/workspaces/<32-hex id>/
 *       original.xlsx   - bytes exactly as uploaded (server-generated name, never a client path)
 *       state.json      - sheets, schema, records (written atomically: tmp -> fsync -> rename)
 *       state.json.bak  - previous good state (used to recover from a malformed/missing state.json)
 *       undo.json       - recent snapshots for Undo
 *       meta.json       - owner (hashed session id), timestamps, expiry
 *
 * Every access is checked against the owner session. A wrong owner and a non-existent id both return 404
 * so workspace ids cannot be probed.
 */
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const logger = require('./logger');
const { AppError, notFound } = require('../middleware/errors');
const { newId, WORKSPACE_ID_RE } = require('./util');
const { safeEqual } = require('../middleware/security');

const ROOT = path.join(config.storageDir, 'workspaces');
const MAX_UNDO = 8;
const UNDO_ROW_BUDGET = 60000; // total rows kept across all undo snapshots

const locks = new Map();
const cache = new Map(); // id -> { state, meta, at }

const hashSid = (sid) => crypto.createHash('sha256').update(String(sid)).digest('hex');

function dirOf(id) {
  if (!WORKSPACE_ID_RE.test(id)) throw notFound('Workspace not found.');
  const dir = path.resolve(ROOT, id);
  if (path.dirname(dir) !== path.resolve(ROOT)) throw notFound('Workspace not found.'); // path-traversal guard
  return dir;
}

async function ensureRoot() {
  await fs.mkdir(ROOT, { recursive: true });
}

async function atomicWrite(file, data) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  const fh = await fs.open(tmp, 'w');
  try {
    await fh.writeFile(data);
    await fh.sync();
  } finally {
    await fh.close();
  }
  await fs.rename(tmp, file);
}

async function writeJson(dir, name, obj, { backup = false } = {}) {
  const file = path.join(dir, name);
  if (backup) {
    try { await fs.copyFile(file, `${file}.bak`); } catch { /* first write */ }
  }
  await atomicWrite(file, JSON.stringify(obj));
}

async function readJsonWithRecovery(dir, name) {
  const file = path.join(dir, name);
  for (const candidate of [file, `${file}.bak`]) {
    try {
      const parsed = JSON.parse(await fs.readFile(candidate, 'utf8'));
      if (candidate !== file) {
        logger.warn('Recovered workspace file from backup', { file: name });
        await atomicWrite(file, JSON.stringify(parsed));
      }
      return parsed;
    } catch { /* try the next candidate */ }
  }
  return null;
}

/** Serialise all mutations of one workspace. */
async function withLock(id, fn) {
  const prev = locks.get(id) || Promise.resolve();
  let release;
  const gate = new Promise((r) => { release = r; });
  const chain = prev.then(() => gate);
  locks.set(id, chain);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(id) === chain) locks.delete(id);
  }
}

function touchMeta(meta) {
  const now = Date.now();
  meta.lastAccess = now;
  meta.expiresAt = now + config.workspaceTtlHours * 3600 * 1000;
}

async function loadMeta(id) {
  const dir = dirOf(id);
  const meta = await readJsonWithRecovery(dir, 'meta.json');
  if (!meta) throw notFound('Workspace not found.');
  return meta;
}

/** Return {dir, meta} only if the session owns the workspace and it hasn't expired. */
async function authorize(id, sid) {
  const dir = dirOf(id);
  let meta;
  try { meta = await loadMeta(id); } catch { throw notFound('Workspace not found.'); }
  if (!sid || !safeEqual(meta.owner, hashSid(sid))) throw notFound('Workspace not found.');
  if (meta.expiresAt < Date.now()) {
    await destroy(id).catch(() => {});
    throw new AppError(410, 'EXPIRED', 'This workspace has expired and was deleted. Please upload your file again.');
  }
  return { dir, meta };
}

async function create(sid, fileName, buffer, parsed, plan) {
  await ensureRoot();
  const id = newId(16);
  const dir = dirOf(id);
  await fs.mkdir(dir, { recursive: true });
  const meta = { id, owner: hashSid(sid), createdAt: Date.now(), plan };
  touchMeta(meta);
  const state = {
    id,
    revision: 1,
    fileName: safeFileName(fileName),
    createdAt: meta.createdAt,
    sheets: parsed.sheets,
    saves: 0,
  };
  try {
    await fs.writeFile(path.join(dir, 'original.xlsx'), buffer);
    await writeJson(dir, 'state.json', state);
    await writeJson(dir, 'undo.json', []);
    await writeJson(dir, 'meta.json', meta);
  } catch (err) {
    await fs.rm(dir, { recursive: true, force: true });
    throw err;
  }
  cache.set(id, { state, at: Date.now() });
  return state;
}

function safeFileName(name) {
  const base = path.basename(String(name || 'workbook.xlsx')).replace(/[^\w.\- ()]/g, '_').replace(/\.{2,}/g, '.').slice(0, 100);
  return /\.xlsx$/i.test(base) ? base : `${base || 'workbook'}.xlsx`;
}

async function loadState(id, dir) {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.state;
  const state = await readJsonWithRecovery(dir, 'state.json');
  if (!state || !Array.isArray(state.sheets)) {
    throw new AppError(500, 'STATE_LOST', 'This workspace could not be restored. Please upload your file again.');
  }
  cache.set(id, { state, at: Date.now() });
  return state;
}

/** Read-only access. Extends the workspace lifetime. */
async function read(id, sid) {
  const { dir, meta } = await authorize(id, sid);
  const state = await loadState(id, dir);
  if (Date.now() - (meta.lastAccess || 0) > 5 * 60 * 1000) {
    touchMeta(meta);
    writeJson(dir, 'meta.json', meta).catch(() => {});
  }
  return state;
}

/**
 * Mutate under lock. `fn(state)` may mutate state freely; it must throw to abort.
 * We work on a deep copy so a thrown error or failed write leaves the saved state untouched.
 */
async function mutate(id, sid, { baseRevision, undoLabel, sheetId } = {}, fn) {
  return withLock(id, async () => {
    const { dir, meta } = await authorize(id, sid);
    const current = await loadState(id, dir);
    if (baseRevision !== undefined && baseRevision !== current.revision) {
      throw new AppError(409, 'STALE', 'This workbook changed in another tab or window. Reload to see the latest version before saving.', { revision: current.revision });
    }
    const draft = structuredClone(current);
    const result = await fn(draft, { dir });
    draft.revision = current.revision + 1;
    draft.saves = (current.saves || 0) + 1;
    draft.savedAt = Date.now();
    if (undoLabel && sheetId) {
      const sheet = current.sheets.find((s) => s.id === sheetId);
      if (sheet) await pushUndo(dir, { label: undoLabel, sheetId, at: Date.now(), revision: current.revision, sheet });
    }
    await writeJson(dir, 'state.json', draft, { backup: true });
    touchMeta(meta);
    await writeJson(dir, 'meta.json', meta);
    cache.set(id, { state: draft, at: Date.now() });
    return { state: draft, result };
  });
}

async function pushUndo(dir, entry) {
  const list = (await readJsonWithRecovery(dir, 'undo.json')) || [];
  list.push(entry);
  while (list.length > MAX_UNDO) list.shift();
  let budget = UNDO_ROW_BUDGET;
  const kept = [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    budget -= list[i].sheet.rows.length + 1;
    if (budget < 0 && kept.length) break;
    kept.unshift(list[i]);
  }
  await writeJson(dir, 'undo.json', kept);
}

async function undoInfo(id, sid) {
  const { dir } = await authorize(id, sid);
  const list = (await readJsonWithRecovery(dir, 'undo.json')) || [];
  return list.map((e) => ({ label: e.label, sheetId: e.sheetId, at: e.at }));
}

async function undo(id, sid) {
  return withLock(id, async () => {
    const { dir, meta } = await authorize(id, sid);
    const current = await loadState(id, dir);
    const list = (await readJsonWithRecovery(dir, 'undo.json')) || [];
    const entry = list.pop();
    if (!entry) throw new AppError(409, 'NOTHING_TO_UNDO', 'There is nothing to undo.');
    const draft = structuredClone(current);
    const idx = draft.sheets.findIndex((s) => s.id === entry.sheetId);
    if (idx === -1) throw new AppError(409, 'NOTHING_TO_UNDO', 'That sheet no longer exists.');
    entry.sheet.charts = draft.sheets[idx].charts; // saved charts are not part of undo
    draft.sheets[idx] = entry.sheet;
    draft.revision = current.revision + 1;
    draft.savedAt = Date.now();
    await writeJson(dir, 'state.json', draft, { backup: true });
    await writeJson(dir, 'undo.json', list);
    touchMeta(meta);
    await writeJson(dir, 'meta.json', meta);
    cache.set(id, { state: draft, at: Date.now() });
    return { state: draft, label: entry.label, sheetId: entry.sheetId };
  });
}

async function originalBuffer(id, sid) {
  const { dir } = await authorize(id, sid);
  return fs.readFile(path.join(dir, 'original.xlsx'));
}

async function destroy(id) {
  const dir = dirOf(id);
  cache.delete(id);
  locks.delete(id);
  await fs.rm(dir, { recursive: true, force: true });
}

async function destroyOwned(id, sid) {
  return withLock(id, async () => {
    await authorize(id, sid);
    await destroy(id);
  });
}

async function listOwned(sid) {
  await ensureRoot();
  const out = [];
  const owner = hashSid(sid);
  for (const name of await fs.readdir(ROOT)) {
    if (!WORKSPACE_ID_RE.test(name)) continue;
    try {
      const meta = await loadMeta(name);
      if (!safeEqual(meta.owner, owner) || meta.expiresAt < Date.now()) continue;
      const state = await loadState(name, dirOf(name));
      out.push({ id: name, fileName: state.fileName, sheets: state.sheets.length, expiresAt: meta.expiresAt, lastAccess: meta.lastAccess, createdAt: meta.createdAt || null, savedAt: state.savedAt || null });
    } catch { /* skip unreadable */ }
  }
  return out.sort((a, b) => b.lastAccess - a.lastAccess);
}

async function countOwned(sid) {
  return (await listOwned(sid)).length;
}

/** Delete expired / broken workspaces and stale temp files. Returns number removed. */
async function cleanupExpired() {
  await ensureRoot();
  let removed = 0;
  const now = Date.now();
  for (const name of await fs.readdir(ROOT)) {
    if (!WORKSPACE_ID_RE.test(name)) continue;
    const dir = path.join(ROOT, name);
    try {
      const meta = await readJsonWithRecovery(dir, 'meta.json');
      if (!meta || meta.expiresAt < now) {
        await destroy(name);
        removed += 1;
        continue;
      }
      for (const f of await fs.readdir(dir)) {
        if (f.endsWith('.tmp')) {
          const st = await fs.stat(path.join(dir, f));
          if (now - st.mtimeMs > 10 * 60 * 1000) await fs.rm(path.join(dir, f), { force: true });
        }
      }
    } catch (err) {
      logger.warn('Cleanup skipped a workspace', { id: name, error: err.message });
    }
  }
  if (removed) logger.info('Expired workspaces removed', { removed });
  return removed;
}

function startCleanupTimer() {
  cleanupExpired().catch((e) => logger.error('Cleanup failed', { error: e.message }));
  const t = setInterval(() => {
    cleanupExpired().catch((e) => logger.error('Cleanup failed', { error: e.message }));
  }, config.cleanupIntervalMinutes * 60 * 1000);
  t.unref();
  return t;
}

/** Test helper */
function _clearCache() {
  cache.clear();
}

module.exports = {
  create, read, mutate, undo, undoInfo, originalBuffer, destroy, destroyOwned, listOwned, countOwned,
  cleanupExpired, startCleanupTimer, hashSid, safeFileName, ROOT, _clearCache,
};
