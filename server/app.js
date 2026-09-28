'use strict';

const express = require('express');
const { createApiRouter } = require('./http/routes');
const { createAuthRouter } = require('./http/routes/auth-routes');
const { createStaticSite } = require('./http/static-site');
const { createAuthenticationMiddleware } = require('./http/middleware/authentication');
const { createDataScopeMiddleware } = require('./http/middleware/data-scope');
const { createErrorHandler, notFoundHandler } = require('./http/middleware/error-handler');
const { createRequestLogger } = require('./http/middleware/request-logger');
const { createSecurityHeaders } = require('./http/middleware/security-headers');

/**
 * Compose the Express application from already-built collaborators.
 *
 * `createApp` receives everything it needs (configuration, logger, services)
 * and constructs nothing itself, so tests can run the real HTTP stack against
 * fake services, and the wiring of the real ones lives in one place
 * (`container.js`).
 *
 * @param {object} container see {@link module:server/container}
 * @returns {import('express').Express}
 */
function createApp(container) {
  const { config, logger } = container;
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.http.trustProxy);

  app.use(createSecurityHeaders({ frameOptions: config.http.frameOptions }));
  app.use(createRequestLogger({ logger: logger.child('http') }));
  app.use(express.json({ limit: config.http.bodyLimit }));
  app.use(express.text({ limit: config.http.bodyLimit, type: ['text/*', 'application/*'] }));

  const { requireUser, attachUserIfPresent, requireOwner } = createAuthenticationMiddleware(container);
  const attachDataScope = createDataScopeMiddleware(container);
  const deps = { ...container, requireUser, requireOwner };

  // Sign-in endpoints are the only part of /api reachable without a session.
  app.use('/api/auth', createAuthRouter(deps));
  // Every other endpoint needs a session *and* a resolved data scope: which
  // account's data this request reads, and the account whose id writes take.
  app.use('/api', requireUser, attachDataScope, createApiRouter(deps));
  app.use('/api', notFoundHandler);

  app.use(createStaticSite({ config, attachUserIfPresent }));

  app.use(createErrorHandler({ logger: logger.child('api') }));
  return app;
}

module.exports = { createApp };
