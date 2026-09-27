'use strict';

const { AppError } = require('../../core/errors');
const { silentLogger } = require('../../core/logger');

/**
 * The one place that turns an error into an HTTP response.
 *
 * Domain errors carry their own status and a message meant for humans;
 * everything else is logged in full and answered with a generic 500, so stack
 * traces and driver text never leak to a client.
 *
 * @param {{ logger?: object }} [deps]
 * @returns {import('express').ErrorRequestHandler}
 */
function createErrorHandler({ logger = silentLogger } = {}) {
  return function errorHandler(error, req, res, _next) {
    const status = error instanceof AppError ? error.status : error.status || 500;
    const expose = error instanceof AppError ? error.expose : false;

    if (status >= 500) logger.error(`${req.method} ${req.originalUrl} →`, error.stack || error.message);
    else logger.debug(`${req.method} ${req.originalUrl} → ${status}: ${error.message}`);

    if (res.headersSent) return;
    const body = { error: expose && error.message ? error.message : 'Internal server error' };
    if (error instanceof AppError && error.details !== undefined) body.details = error.details;
    res.status(status).json(body);
  };
}

/** Terminal 404 for unknown API routes (HTML routes fall through to static). */
function notFoundHandler(_req, res) {
  res.status(404).json({ error: 'not found' });
}

module.exports = { createErrorHandler, notFoundHandler };
