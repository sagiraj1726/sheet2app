'use strict';

const logger = require('../services/logger');

class AppError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const notFound = (what = 'Not found') => new AppError(404, 'NOT_FOUND', what);

function apiNotFound(req, res) {
  res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.message, code: err.code, ...err.extra });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request is too large.', code: 'TOO_LARGE' });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON in request.', code: 'BAD_JSON' });
  }
  if (err && err.name === 'MulterError') {
    const tooBig = err.code === 'LIMIT_FILE_SIZE';
    return res.status(tooBig ? 413 : 400).json({
      error: tooBig ? 'That file is larger than your plan allows.' : 'The upload could not be processed.',
      code: tooBig ? 'FILE_TOO_LARGE' : 'UPLOAD_ERROR',
    });
  }
  // Detailed error goes to the server log only. Clients get a generic message (no paths, no stack).
  logger.error('Unhandled error', { path: req.path, method: req.method, error: err && err.message, stack: err && err.stack });
  res.status(500).json({ error: 'Something went wrong on our side. Please try again.', code: 'INTERNAL' });
}

module.exports = { AppError, notFound, apiNotFound, errorHandler };
