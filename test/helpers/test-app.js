'use strict';

const http = require('http');
const { loadConfig } = require('../../server/config');
const { silentLogger } = require('../../server/core/logger');
const { createApp } = require('../../server/app');

const BASE_ENV = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  SESSION_SECRET: 'test-secret-value',
  GOOGLE_CLIENT_ID: 'test-client-id',
  DATABASE_URL: ''
};

const notImplemented = (name) => () => {
  throw new Error(`${name} was called but not stubbed in this test`);
};

/**
 * Build the real HTTP stack (routing, auth guards, error handling) on top of
 * stub services.
 *
 * This is only possible because `createApp` takes its collaborators as an
 * argument — no database, no network and no environment are involved.
 *
 * @param {{ user?: object|null, env?: object, services?: object }} [options]
 */
function createTestApp({ user = { email: 'owner@example.com', name: 'Owner', role: 'owner' }, env = {}, services = {} } = {}) {
  const config = loadConfig({ ...BASE_ENV, ...env });

  const container = {
    config,
    logger: silentLogger,
    authenticationService: {
      describeClientConfig: () => ({ clientId: config.auth.googleClientId }),
      resolveCurrentUser: async () => user,
      signInWithGoogle: notImplemented('signInWithGoogle')
    },
    sessionService: {
      cookieName: 'shootingtracker_session',
      cookieOptions: () => ({ httpOnly: true, path: '/' }),
      issue: () => 'token',
      fromRequest: () => null
    },
    shootService: {},
    paymentService: {},
    mediaService: {},
    coordinatorService: {},
    dashboardService: {},
    metadataService: {},
    healthService: {},
    accessService: {},
    importService: {},
    ...services
  };

  return { app: createApp(container), container, config };
}

/** Start an app on an ephemeral port and return a fetch bound to it. */
async function startServer(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    /** @returns {Promise<{ status: number, body: any, headers: Headers }>} */
    async request(path, options = {}) {
      const init = { method: options.method || 'GET', headers: { ...(options.headers || {}) } };
      if (options.body !== undefined) {
        init.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
        init.headers['Content-Type'] = init.headers['Content-Type'] || 'application/json';
      }
      const response = await fetch(baseUrl + path, init);
      const contentType = response.headers.get('content-type') || '';
      const body = contentType.includes('json') ? await response.json() : await response.text();
      return { status: response.status, body, headers: response.headers };
    },
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

module.exports = { createTestApp, startServer, BASE_ENV };
