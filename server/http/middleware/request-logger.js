'use strict';

const { silentLogger } = require('../../core/logger');

/**
 * One line per request: method, path, status, duration.
 *
 * Server errors are logged at `error`, everything else at `debug`, so a
 * production deployment stays quiet without losing failures.
 *
 * @param {{ logger?: object, clock?: () => number }} [deps]
 */
function createRequestLogger({ logger = silentLogger, clock = Date.now } = {}) {
  return function requestLogger(req, res, next) {
    const startedAt = clock();
    res.on('finish', () => {
      const line = `${req.method} ${req.originalUrl} ${res.statusCode} ${clock() - startedAt}ms`;
      if (res.statusCode >= 500) logger.error(line);
      else logger.debug(line);
    });
    next();
  };
}

module.exports = { createRequestLogger };
