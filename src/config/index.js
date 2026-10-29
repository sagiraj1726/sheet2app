'use strict';

require('dotenv').config({ quiet: true });
const path = require('path');

function int(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < min || n > max) return fallback;
  return n;
}

const bool = (value) => String(value).toLowerCase() === 'true';

const config = {
  env: process.env.NODE_ENV || 'development',
  port: int(process.env.PORT, 3000, { max: 65535 }),
  // Localhost by default. Never bind to all interfaces unless deliberately placed behind a reverse proxy.
  host: process.env.HOST || '127.0.0.1',
  maxUploadMB: int(process.env.MAX_UPLOAD_MB, 10, { max: 100 }),
  maxSheets: int(process.env.MAX_SHEETS, 30, { max: 200 }),
  maxRowsPerSheet: int(process.env.MAX_ROWS_PER_SHEET, 50000, { max: 500000 }),
  workspaceTtlHours: int(process.env.WORKSPACE_TTL_HOURS, 24, { max: 24 * 30 }),
  cleanupIntervalMinutes: int(process.env.CLEANUP_INTERVAL_MINUTES, 30, { max: 24 * 60 }),
  trustProxy: bool(process.env.TRUST_PROXY),
  cookieSecure: bool(process.env.COOKIE_SECURE),
  plan: (process.env.PLAN || 'free').toLowerCase(),
  currency: process.env.CURRENCY_SYMBOL || '₹',
  billing: {
    provider: process.env.BILLING_PROVIDER || '',
    checkoutUrl: process.env.BILLING_CHECKOUT_URL || '',
  },
  storageDir: process.env.STORAGE_DIR
    ? path.resolve(process.env.STORAGE_DIR)
    : path.join(__dirname, '..', '..', 'storage'),
  publicDir: path.join(__dirname, '..', '..', 'public'),
};

module.exports = config;
