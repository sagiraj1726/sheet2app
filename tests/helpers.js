'use strict';

/** Shared test harness: isolated storage dir, real HTTP server on an ephemeral localhost port. */
const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.NODE_ENV = 'test';
process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 's2a-test-'));
process.env.PLAN = process.env.PLAN || 'business'; // generous limits; plan-limit tests override via env module
process.env.WORKSPACE_TTL_HOURS = '24';

const { createApp } = require('../app');

async function startServer(opts) {
  const app = createApp(opts);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, base, close: () => new Promise((r) => server.close(r)) };
}

/** Minimal cookie-aware client. Each client = one anonymous browser session. */
class Client {
  constructor(base) {
    this.base = base;
    this.cookie = '';
  }

  async req(method, url, { json, form, headers = {}, raw } = {}) {
    const h = { 'x-requested-with': 'Sheet2App', ...headers };
    if (this.cookie) h.cookie = this.cookie;
    let body;
    if (json !== undefined) { h['content-type'] = 'application/json'; body = JSON.stringify(json); }
    if (form) body = form;
    const res = await fetch(this.base + url, { method, headers: h, body });
    const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const c of set) this.cookie = c.split(';')[0];
    if (raw) return res;
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  }

  get(url, o) { return this.req('GET', url, o); }
  post(url, json, o) { return this.req('POST', url, { json, ...o }); }
  put(url, json, o) { return this.req('PUT', url, { json, ...o }); }
  del(url, o) { return this.req('DELETE', url, o); }

  upload(buffer, name = 'test.xlsx', type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
    const form = new FormData();
    form.append('file', new Blob([buffer], { type }), name);
    return this.req('POST', '/api/workbooks/upload', { form });
  }
}

module.exports = { startServer, Client };
