'use strict';

const express = require('express');
const helmet = require('helmet');
const path = require('path');
const { rateLimit } = require('express-rate-limit');
const config = require('./src/config');
const { session, csrfGuard } = require('./src/middleware/security');
const { errorHandler, apiNotFound } = require('./src/middleware/errors');

function limiter(windowMs, limit, message) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: message, code: 'RATE_LIMITED' },
  });
}

function createApp(opts = {}) {
  const rl = { api: 600, heavy: 30, ...(opts.rateLimits || {}) };
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"], // ECharts + dynamic widths set inline styles; scripts stay locked down
          imgSrc: ["'self'", 'data:', 'blob:'],
          fontSrc: ["'self'"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      hsts: config.cookieSecure ? undefined : false,
    }),
  );

  const api = express.Router();
  api.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  api.use(limiter(60 * 1000, rl.api, 'You are doing that too fast. Please wait a moment.'));
  api.use(session);
  api.use(csrfGuard);
  api.use(express.json({ limit: '4mb' }));
  api.use('/', require('./src/routes/meta'));
  const heavy = limiter(10 * 60 * 1000, rl.heavy, 'Too many uploads or downloads. Please try again in a few minutes.');
  api.use('/workbooks/upload', heavy);
  api.use('/workbooks/sample', heavy);
  api.use(/^\/workbooks\/[^/]+\/(export\.xlsx|sheets\/[^/]+\/export\.csv)$/, heavy);
  api.use('/workbooks', require('./src/routes/upload'));
  api.use('/workbooks', require('./src/routes/workbooks'));
  api.use('/workbooks', require('./src/routes/insights'));
  api.use('/workbooks', require('./src/routes/export'));
  api.use(apiNotFound);
  app.use('/api', api);

  // Charting library served from node_modules (no CDN, no third-party requests).
  app.get('/vendor/echarts.min.js', (req, res) => {
    res.set('Cache-Control', 'public, max-age=86400');
    res.sendFile(require.resolve('echarts/dist/echarts.min.js'));
  });

  const pub = config.publicDir;
  const page = (name) => (req, res) => res.sendFile(path.join(pub, name));
  app.get('/app', page('app.html'));
  app.get('/pricing', page('pricing.html'));
  app.get('/privacy', page('privacy.html'));
  app.use(express.static(pub, { index: 'index.html', extensions: ['html'], dotfiles: 'ignore', maxAge: config.env === 'production' ? '1h' : 0 }));

  app.use((req, res) => res.status(404).sendFile(path.join(pub, '404.html')));
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
