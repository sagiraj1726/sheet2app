'use strict';

const config = require('./src/config');
const logger = require('./src/services/logger');
const workspace = require('./src/services/workspace.service');
const { createApp } = require('./app');

const app = createApp();
workspace.startCleanupTimer();

const server = app.listen(config.port, config.host, () => {
  logger.info('Sheet2App is running', { url: `http://${config.host}:${config.port}`, plan: config.plan });
  if (config.host === '127.0.0.1' || config.host === 'localhost') {
    console.log(`\n  Sheet2App is ready  →  http://localhost:${config.port}\n`);
  }
});

server.requestTimeout = 60_000;
server.headersTimeout = 20_000;

function shutdown(signal) {
  logger.info('Shutting down', { signal });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => logger.error('Unhandled rejection', { error: err && err.message }));
