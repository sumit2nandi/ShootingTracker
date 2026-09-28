'use strict';

const http = require('http');
const { loadConfig } = require('../../server/config');
const { silentLogger } = require('../../server/core/logger');
const { createApp } = require('../../server/app');
const { DataScopeService } = require('../../server/services/data-scope-service');

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
function createTestApp({
  user = { id: 1, email: 'owner@example.com', name: 'Owner', role: 'owner', tour_completed: true },
  env = {},
  services = {}
} = {}) {
  const config = loadConfig({ ...BASE_ENV, ...env });

  // A two-account directory: the signed-in account (id 1) and, for the
  // owner's viewingAs parameter, any other email (id 2).
  const scopeDirectory = {
    lookup: async (email) => {
      const normalized = String(email).toLowerCase();
      if (user && normalized === String(user.email).toLowerCase()) {
        return { ...user, is_active: true };
      }
      return { id: 2, email: normalized, name: null, role: 'member', is_active: true, tour_completed: true };
    }
  };

  const container = {
    config,
    logger: silentLogger,
    dataScopeService: new DataScopeService({ userDirectory: scopeDirectory }),
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
