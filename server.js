'use strict';

const logger = require('./src/services/logger');
const workspace = require('./src/services/workspace.service');
const { createApp } = require('./app');

const app = createApp();

workspace.startCleanupTimer();

// Use hosting provider port
const PORT = process.env.PORT || 3000;

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
  logger.info('Sheet2App is running', {
    port: PORT
  });

  console.log(`✅ Sheet2App running on port ${PORT}`);
});

// Timeouts
server.requestTimeout = 60000;
server.headersTimeout = 20000;

// Graceful shutdown
function shutdown(signal) {
  logger.info('Shutting down', { signal });

  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });

  setTimeout(() => {
    process.exit(1);
  }, 5000).unref();
}

// Process handlers
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});
