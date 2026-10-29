'use strict';

// Minimal structured (JSON) logger. Never pass secrets, cell contents or tokens into it.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = process.env.NODE_ENV === 'test' ? LEVELS.error + 1 : LEVELS[process.env.LOG_LEVEL] || LEVELS.info;

function log(level, message, meta = {}) {
  if (LEVELS[level] < threshold) return;
  const line = JSON.stringify({ time: new Date().toISOString(), level, message, ...meta });
  (level === 'error' ? console.error : console.log)(line);
}

module.exports = {
  debug: (m, x) => log('debug', m, x),
  info: (m, x) => log('info', m, x),
  warn: (m, x) => log('warn', m, x),
  error: (m, x) => log('error', m, x),
};
