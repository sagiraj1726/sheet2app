/* Sheet2App shared helpers: icons, API client, toasts, dialogs, nav/footer, upload flow. */
(function () {
  'use strict';

  const P = {
    upload: '<path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
    download: '<path d="M12 4v12m0 0 4.5-4.5M12 16l-4.5-4.5M4 19h16"/>',
    sheet: '<rect x="3.5" y="4" width="17" height="16" rx="2.5"/><path d="M3.5 9.5h17M9.5 4v16"/>',
    form: '<rect x="4" y="3.5" width="16" height="17" rx="2.5"/><path d="M8 8.5h8M8 12.5h8M8 16.5h4.5"/>',
    chart: '<path d="M4 20V10m6 10V4m6 16v-7m4 7H3"/>',
    wand: '<path d="m5 19 9-9m0 0 1.5-1.5a1.8 1.8 0 0 1 2.5 0l.5.5a1.8 1.8 0 0 1 0 2.5L17 13m-3-3 3 3M6 5v3M4.5 6.5h3M18 17v3M16.5 18.5h3M11 3v2M10 4h2"/>',
    bulb: '<path d="M9 18h6m-5 3h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3Z"/>',
    shield: '<path d="M12 3 5 6v5.5c0 4.4 2.9 7.9 7 9.5 4.1-1.6 7-5.1 7-9.5V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    trash: '<path d="M4.5 7h15M10 11v6m4-6v6M6.5 7l.8 11.2a2 2 0 0 0 2 1.8h5.4a2 2 0 0 0 2-1.8L17.5 7M9 7V4.5h6V7"/>',
    edit: '<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Zm9-13 3 3"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
    undo: '<path d="M9 8 4.5 12.5 9 17M5 12.5h9.5a5 5 0 0 1 0 10"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5v.1"/>',
    alert: '<path d="M12 4 2.8 19.5h18.4L12 4Z"/><path d="M12 10v4.5M12 17.2v.1"/>',
    grip: '<circle cx="9" cy="6" r="1.2"/><circle cx="15" cy="6" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="9" cy="18" r="1.2"/><circle cx="15" cy="18" r="1.2"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/>',
    eyeoff: '<path d="M4 4l16 16M10.3 6A8.6 8.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-3 3.8M6.6 7.7A15 15 0 0 0 2.5 12S6 18.5 12 18.5a8.5 8.5 0 0 0 3.7-.9M9.9 9.9a2.8 2.8 0 0 0 4 4"/>',
    up: '<path d="m6 14 6-6 6 6"/>',
    down: '<path d="m6 10 6 6 6-6"/>',
    left: '<path d="m14 6-6 6 6 6"/>',
    right: '<path d="m10 6 6 6-6 6"/>',
    sort: '<path d="M8 5v14m0 0-3-3m3 3 3-3M16 19V5m0 0-3 3m3-3 3 3"/>',
    filter: '<path d="M4 5h16l-6 7.5V19l-4-2v-4.5L4 5Z"/>',
    home: '<path d="M4 11 12 4l8 7v8.5a1 1 0 0 1-1 1h-4.5V15h-5v5.5H5a1 1 0 0 1-1-1V11Z"/>',
    layers: '<path d="m12 3.5 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>',
    cog: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5m0 13V21M3 12h2.5m13 0H21M5.6 5.6l1.8 1.8m9.2 9.2 1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8"/>',
    print: '<path d="M7 9V4h10v5M7 17H5a1.5 1.5 0 0 1-1.5-1.5v-5A1.5 1.5 0 0 1 5 9h14a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 19 17h-2M7 14h10v6H7z"/>',
    image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="m4 17 5-5 4 4 2.5-2.5L20 16.5"/>',
    users: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3 19.5c.6-3 3-4.8 6-4.8s5.4 1.8 6 4.8M16 5.6a3.2 3.2 0 0 1 0 6.3M18 14.9c1.6.6 2.7 2.1 3 4.6"/>',
    cart: '<path d="M3 4h2.5l2 11h10l2-8H7"/><circle cx="9.5" cy="19" r="1.4"/><circle cx="16.5" cy="19" r="1.4"/>',
    school: '<path d="m2.5 9.5 9.5-5 9.5 5-9.5 5-9.5-5Z"/><path d="M6.5 12v4.3c0 1 2.5 2.7 5.5 2.7s5.5-1.7 5.5-2.7V12M21.5 9.5V15"/>',
    briefcase: '<rect x="3.5" y="7.5" width="17" height="12" rx="2.5"/><path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5M3.5 13h17"/>',
    building: '<path d="M5 20.5V5.5a1.5 1.5 0 0 1 1.5-1.5h7A1.5 1.5 0 0 1 15 5.5v15M15 10h3.5A1.5 1.5 0 0 1 20 11.5v9M3 20.5h18M8.5 8h3M8.5 12h3M8.5 16h3"/>',
    wallet: '<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3M4 7.5V17a2.5 2.5 0 0 0 2.5 2.5H19a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1H6.5A2.5 2.5 0 0 1 4 7.5Z"/><circle cx="16" cy="13.5" r="1.1"/>',
    star: '<path d="m12 3.8 2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8L12 3.8Z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.3-4M4 5v3.5h3.5M4 13a8 8 0 0 0 14.3 4M20 19v-3.5h-3.5"/>',
    file: '<path d="M7 3.5h6.5L19 9v10.5a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 6 19.5v-14A1.5 1.5 0 0 1 7.5 4"/><path d="M13.5 3.5V9H19"/>',
    spinner: '<path d="M12 3a9 9 0 1 0 9 9" />',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    bolt: '<path d="M13 3 5 13.5h6L10 21l8-10.5h-6L13 3Z"/>',
    target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".8"/>',
  };

  function icon(name, cls) {
    return '<svg class="icon' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + (P[name] || '') + '</svg>';
  }

  /** Returns a live SVG DOM node — use when appending to a button/element directly (Firefox innerHTML parses SVG in HTML mode). */
  function iconNode(name, cls) {
    const tmp = document.createElement('div');
    tmp.innerHTML = icon(name, cls);
    return tmp.firstChild;
  }

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /** Tiny hyperscript: h('div.class', {attrs}, children...) - text children are never parsed as HTML. */
  function h(tag, attrs, ...kids) {
    const m = /^([a-z0-9]+)((?:\.[\w-]+)*)$/i.exec(tag);
    const el = document.createElement(m ? m[1] : 'div');
    if (m && m[2]) el.className = m[2].slice(1).split('.').join(' ');
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className += (el.className ? ' ' : '') + v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  // ------------------------------------------------------------ API
  class ApiError extends Error {
    constructor(status, data) {
      super((data && data.error) || 'Something went wrong.');
      this.status = status;
      this.data = data || {};
      this.code = this.data.code;
    }
  }

  async function api(method, url, body) {
    const opts = { method, headers: { 'X-Requested-With': 'Sheet2App' }, credentials: 'same-origin' };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    let res;
    try { res = await fetch(url, opts); } catch { throw new ApiError(0, { error: 'Cannot reach the server. Check your connection and try again.', code: 'NETWORK' }); }
    let data = null;
    try { data = await res.json(); } catch { /* not json */ }
    if (!res.ok) throw new ApiError(res.status, data || { error: 'Something went wrong.' });
    return data;
  }
  api.get = (u) => api('GET', u);
  api.post = (u, b) => api('POST', u, b === undefined ? {} : b);
  api.put = (u, b) => api('PUT', u, b);
  api.del = (u) => api('DELETE', u);

  function uploadFile(file, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/workbooks/upload');
      xhr.setRequestHeader('X-Requested-With', 'Sheet2App');
      xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
      xhr.onload = () => {
        let data = null;
        try { data = JSON.parse(xhr.responseText); } catch { /* ignore */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data); else reject(new ApiError(xhr.status, data || { error: 'Upload failed.' }));
      };
      xhr.onerror = () => reject(new ApiError(0, { error: 'Cannot reach the server. Check your connection and try again.', code: 'NETWORK' }));
      xhr.ontimeout = () => reject(new ApiError(0, { error: 'The upload took too long. Try a smaller file.', code: 'TIMEOUT' }));
      xhr.timeout = 120000;
      const fd = new FormData();
      fd.append('file', file, file.name);
      xhr.send(fd);
    });
  }

  const LAST_KEY = 's2a_last';
  const rememberWorkbook = (id) => { try { localStorage.setItem(LAST_KEY, id); } catch { /* private mode */ } };
  const lastWorkbook = () => { try { return localStorage.getItem(LAST_KEY); } catch { return null; } };
  const forgetWorkbook = () => { try { localStorage.removeItem(LAST_KEY); } catch { /* ignore */ } };
  const openWorkbook = (id) => { rememberWorkbook(id); location.href = '/app?wb=' + encodeURIComponent(id); };

  // ------------------------------------------------------------ toast + dialogs
  function toastHost() {
    let host = $('.toasts');
    if (!host) { host = h('div.toasts', { 'aria-live': 'polite', role: 'status' }); document.body.append(host); }
    return host;
  }
  function toast(type, title, msg, ms) {
    const host = toastHost();
    const el = h('div.toast.' + type, {},
      h('span', { html: icon(type === 'ok' ? 'check' : type === 'err' ? 'alert' : 'info') }),
      h('div', {}, h('b', {}, title), msg ? h('span.small.muted', {}, msg) : null),
      h('button', { 'aria-label': 'Dismiss', onclick: () => el.remove() }, '×'));
    host.append(el);
    const t = setTimeout(() => el.remove(), ms || (type === 'err' ? 9000 : 4500));
    el.addEventListener('mouseenter', () => clearTimeout(t));
    while (host.children.length > 4) host.firstChild.remove();
  }

  function dialog({ title, body, confirmText = 'OK', cancelText = 'Cancel', danger = false, hideCancel = false, extra }) {
    return new Promise((resolve) => {
      const prev = document.activeElement;
      const done = (v) => { back.remove(); document.removeEventListener('keydown', onKey, true); if (prev && prev.focus) prev.focus(); resolve(v); };
      const confirmBtn = h('button.btn.' + (danger ? 'btn-danger' : 'btn-primary'), { onclick: () => done(true) }, confirmText);
      const modal = h('div.modal', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dlg-t' },
        h('h3', { id: 'dlg-t' }, title),
        typeof body === 'string' ? h('div.muted', {}, body) : body,
        extra || null,
        h('div.modal-actions', {}, hideCancel ? null : h('button.btn', { onclick: () => done(false) }, cancelText), confirmBtn));
      const back = h('div.modal-back', { onmousedown: (e) => { if (e.target === back) done(false); } }, modal);
      function onKey(e) {
        if (e.key === 'Escape') { e.stopPropagation(); done(false); }
        if (e.key === 'Tab') {
          const f = $$('button, input, select, textarea, a[href]', modal).filter((x) => !x.disabled);
          if (!f.length) return;
          const first = f[0]; const last = f[f.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
      document.addEventListener('keydown', onKey, true);
      document.body.append(back);
      (danger ? modal.querySelector('.btn:not(.btn-danger)') || confirmBtn : confirmBtn).focus();
    });
  }
  const confirmDialog = (o) => dialog(o);
  const alertDialog = (o) => dialog({ ...o, hideCancel: true });

  // ------------------------------------------------------------ nav + footer
  const LOGO = '<span class="logo-mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4" width="17" height="16" rx="3"/><path d="M3.5 9.5h17M9.5 9.5V20"/><path d="m13 15 2 2 3.5-4" /></svg></span>';

  function renderNav(active) {
    const host = $('#site-nav');
    if (!host) return;
    const link = (href, text, key) => '<a href="' + href + '"' + (active === key ? ' aria-current="page"' : '') + '>' + text + '</a>';
    host.className = 'site-nav';
    host.innerHTML =
      '<div class="wrap nav-in">' +
      '<a class="logo" href="/" aria-label="Sheet2App home">' + LOGO + 'Sheet2App</a>' +
      '<nav class="nav-links" aria-label="Main">' +
      link('/#features', 'Features') + link('/#how', 'How it works') + link('/#use-cases', 'Use cases') + link('/pricing', 'Pricing', 'pricing') + link('/privacy', 'Privacy', 'privacy') +
      '</nav>' +
      '<div class="nav-cta"><button class="btn btn-sm" data-act="demo">Try demo</button><button class="btn btn-primary btn-sm" data-act="upload">' + icon('upload') + ' Upload Excel</button></div>' +
      '<button class="btn btn-ghost btn-icon nav-toggle" aria-label="Menu" aria-expanded="false">' + icon('menu') + '</button>' +
      '</div>';
    $('.nav-toggle', host).addEventListener('click', (e) => {
      const open = host.classList.toggle('open');
      e.currentTarget.setAttribute('aria-expanded', String(open));
    });
  }

  function renderFooter() {
    const host = $('#site-footer');
    if (!host) return;
    host.className = 'site-footer';
    host.innerHTML =
      '<div class="wrap"><div class="foot-grid">' +
      '<div><a class="logo" href="/">' + LOGO + 'Sheet2App</a><p class="small" style="margin-top:14px;max-width:34ch">Your Excel data. A complete application. Upload a workbook, get forms, charts and an updated Excel file.</p></div>' +
      '<div><h4>Product</h4><ul><li><a href="/#features">Features</a></li><li><a href="/#how">How it works</a></li><li><a href="/#use-cases">Use cases</a></li><li><a href="/pricing">Pricing</a></li></ul></div>' +
      '<div><h4>Try it</h4><ul><li><a href="#" data-act="demo">Open the demo</a></li><li><a href="/api/samples/inventory.xlsx">Sample: inventory</a></li><li><a href="/api/samples/expenses.xlsx">Sample: expenses</a></li><li><a href="/api/samples/students.xlsx">Sample: student marks</a></li></ul></div>' +
      '<div><h4>Trust</h4><ul><li><a href="/privacy">Privacy &amp; data handling</a></li><li><a href="/privacy#limits">Known limitations</a></li><li><a href="/pricing#faq">FAQ</a></li></ul></div>' +
      '</div><div class="foot-bottom"><span>© <span id="yr"></span> Sheet2App. Sample data is entirely fictional.</span><span>Your files are processed on this server and deleted automatically.</span></div></div>';
    $('#yr', host).textContent = new Date().getFullYear();
  }

  // ------------------------------------------------------------ shared upload / demo flow (used on every page)
  function friendlyUploadError(err) {
    if (err.code === 'PLAN_LIMIT') return err.message + ' You can see plan limits on the Pricing page.';
    return err.message;
  }

  async function chooseAndUpload(statusEl, progressEl) {
    const input = h('input', { type: 'file', accept: '.xlsx', class: 'sr-only', tabindex: '-1' });
    document.body.append(input);
    input.addEventListener('change', () => { if (input.files[0]) handleFile(input.files[0], statusEl, progressEl); input.remove(); });
    input.click();
  }

  async function handleFile(file, statusEl, progressEl) {
    const set = (msg, err) => { if (statusEl) { statusEl.textContent = msg; statusEl.classList.toggle('err', Boolean(err)); } else if (err) toast('err', 'Upload failed', msg); };
    if (!/\.xlsx$/i.test(file.name)) {
      set(/\.xls$/i.test(file.name) ? 'Old .xls files are not supported yet. In Excel use File → Save As → Excel Workbook (*.xlsx), then upload that file.' : 'Please choose an Excel workbook (.xlsx).', true);
      return;
    }
    set('Uploading ' + file.name + '…');
    if (progressEl) { progressEl.hidden = false; progressEl.firstElementChild.style.width = '4%'; }
    try {
      const ov = await uploadFile(file, (p) => { if (progressEl) progressEl.firstElementChild.style.width = Math.max(4, Math.round(p * 90)) + '%'; if (p >= 1) set('Reading every sheet and building your app…'); });
      if (progressEl) progressEl.firstElementChild.style.width = '100%';
      set('Done. Opening your workspace…');
      openWorkbook(ov.id);
    } catch (e) {
      if (progressEl) progressEl.hidden = true;
      set(friendlyUploadError(e), true);
    }
  }

  async function startSample(name, statusEl) {
    if (statusEl) { statusEl.textContent = 'Preparing the demo workbook…'; statusEl.classList.remove('err'); }
    try {
      const ov = await api.post('/api/workbooks/sample', { name: name || 'demo' });
      openWorkbook(ov.id);
    } catch (e) {
      if (statusEl) { statusEl.textContent = friendlyUploadError(e); statusEl.classList.add('err'); } else toast('err', 'Could not open demo', e.message);
    }
  }

  function wireGlobalActions(statusEl, progressEl) {
    document.addEventListener('click', (e) => {
      const t = e.target.closest('[data-act]');
      if (!t) return;
      const act = t.getAttribute('data-act');
      if (act === 'upload') { e.preventDefault(); chooseAndUpload(statusEl, progressEl); }
      if (act === 'demo') { e.preventDefault(); startSample('demo', statusEl); }
      if (act === 'sample') { e.preventDefault(); startSample(t.getAttribute('data-name'), statusEl); }
    });
  }

  window.S2A = {
    icon, iconNode, esc, $, $$, h, api, ApiError, uploadFile, toast, confirmDialog, alertDialog, dialog,
    renderNav, renderFooter, chooseAndUpload, handleFile, startSample, wireGlobalActions,
    openWorkbook, rememberWorkbook, lastWorkbook, forgetWorkbook, friendlyUploadError, LOGO,
  };

  document.addEventListener('DOMContentLoaded', () => {
    $$('[data-icon]').forEach((el) => { el.insertAdjacentHTML('afterbegin', icon(el.getAttribute('data-icon'))); });
  });
})();
