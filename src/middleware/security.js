'use strict';

const crypto = require('crypto');
const config = require('../config');
const { AppError } = require('./errors');

const COOKIE = 's2a_sid';
const SID_RE = /^[A-Za-z0-9_-]{32}$/;

function readCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > -1 && part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return null;
}

/** Anonymous, unguessable browser session. Workspaces are bound to it. */
function session(req, res, next) {
  let sid = readCookie(req.headers.cookie, COOKIE);
  if (!sid || !SID_RE.test(sid)) {
    sid = crypto.randomBytes(24).toString('base64url');
    const attrs = [`${COOKIE}=${sid}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${60 * 60 * 24 * 30}`];
    if (config.cookieSecure) attrs.push('Secure');
    res.append('Set-Cookie', attrs.join('; '));
  }
  req.sid = sid;
  next();
}

/**
 * CSRF defence for a cookie-authenticated JSON/multipart API:
 *  - SameSite=Strict cookie
 *  - state-changing requests must carry a custom header (forces a CORS preflight that we never grant)
 *  - Origin, when present, must match Host
 */
function csrfGuard(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  if (req.get('x-requested-with') !== 'Sheet2App') {
    return next(new AppError(403, 'CSRF', 'Request rejected.'));
  }
  const origin = req.get('origin');
  if (origin) {
    let host;
    try {
      host = new URL(origin).host;
    } catch {
      return next(new AppError(403, 'CSRF', 'Request rejected.'));
    }
    if (host !== req.get('host')) return next(new AppError(403, 'CSRF', 'Request rejected.'));
  }
  next();
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

module.exports = { session, csrfGuard, safeEqual, SID_RE };
