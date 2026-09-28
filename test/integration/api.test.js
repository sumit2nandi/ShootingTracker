'use strict';

/**
 * Contract tests for the HTTP surface.
 *
 * They run the real Express stack — security headers, body parsing, auth
 * guards, routers, error handler — against stub services, so they pin the
 * public API (paths, status codes, JSON shapes) without needing a database.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp, startServer } = require('../helpers/test-app');
const {
  NotFoundError, ValidationError, ConflictError, ForbiddenError, ServiceUnavailableError
} = require('../../server/core/errors');

/** Boot an app for one test and always tear the server down. */
async function withApp(options, run) {
  const { app, container } = createTestApp(options);
  const server = await startServer(app);
  try {
    await run(server, container);
  } finally {
    await server.close();
  }
}

test('every /api route requires a session', async () => {
  await withApp({ user: null }, async (server) => {
    for (const path of ['/api/health', '/api/meta', '/api/dashboard', '/api/shoots', '/api/users']) {
      const response = await server.request(path);
      assert.equal(response.status, 401, path);
      assert.deepEqual(response.body, { error: 'Sign-in required' });
    }
    assert.equal((await server.request('/api/shoots', { method: 'POST', body: { title: 'x' } })).status, 401);
  });
});

test('the sign-in endpoints stay reachable while signed out', async () => {
  await withApp({ user: null }, async (server) => {
    const config = await server.request('/api/auth/config');
    assert.equal(config.status, 200);
    assert.deepEqual(config.body, { clientId: 'test-client-id' });
    assert.equal(config.headers.get('cache-control'), 'no-store');

    assert.equal((await server.request('/api/auth/me')).status, 401);
    assert.deepEqual((await server.request('/api/auth/logout', { method: 'POST' })).body, { ok: true });
  });
});

test('sign-in sets a session cookie and returns the user', async () => {
  const services = {
    authenticationService: {
      describeClientConfig: () => ({ clientId: 'test-client-id' }),
      resolveCurrentUser: async () => null,
      signInWithGoogle: async (credential) => {
        assert.equal(credential, 'google-jwt');
        return { user: { email: 'a@example.com', name: 'A' }, token: 'signed-token' };
      }
    }
  };
  await withApp({ user: null, services }, async (server) => {
    const response = await server.request('/api/auth/google', { method: 'POST', body: { credential: 'google-jwt' } });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { user: { email: 'a@example.com', name: 'A' } });
    assert.match(response.headers.get('set-cookie'), /shootingtracker_session=signed-token/);
    assert.match(response.headers.get('set-cookie'), /HttpOnly/i);
  });
});

test('a signed-in user gets their own profile', async () => {
  await withApp({}, async (server) => {
    const response = await server.request('/api/auth/me');
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.user, {
      id: 1,
      email: 'owner@example.com',
      name: 'Owner',
      role: 'owner',
      tour_completed: true
    });
  });
});

test('a new account signs in flagged for consent, with no session cookie', async () => {
  const services = {
    authenticationService: {
      describeClientConfig: () => ({ clientId: 'test-client-id' }),
      resolveCurrentUser: async () => null,
      signInWithGoogle: async (credential) => {
        assert.equal(credential, 'google-jwt');
        return { user: { email: 'new@example.com', name: 'New' }, needsConsent: true };
      }
    }
  };
  await withApp({ user: null, services }, async (server) => {
    const response = await server.request('/api/auth/google', { method: 'POST', body: { credential: 'google-jwt' } });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { user: { email: 'new@example.com', name: 'New' }, needsConsent: true });
    assert.equal(response.headers.get('set-cookie'), null, 'no cookie before the profile exists');
  });
});

test('consent completes a first sign-in with a session cookie', async () => {
  const services = {
    authenticationService: {
      describeClientConfig: () => ({ clientId: 'test-client-id' }),
      resolveCurrentUser: async () => null,
      acceptConsent: async (credential, name) => {
        assert.equal(credential, 'google-jwt');
        return { user: { email: 'new@example.com', name: name || 'New' }, token: 'signed-token' };
      }
    }
  };
  await withApp({ user: null, services }, async (server) => {
    const response = await server.request('/api/auth/consent', {
      method: 'POST',
      body: { credential: 'google-jwt', name: 'New Name' }
    });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { user: { email: 'new@example.com', name: 'New Name' } });
    assert.match(response.headers.get('set-cookie'), /shootingtracker_session=signed-token/);
  });
});

test('the tour-completed flag is saved for the signed-in account', async () => {
  const calls = [];
  const services = {
    accessService: {
      markTourCompleted: async (email) => calls.push(email)
    }
  };
  await withApp({ services }, async (server) => {
    assert.equal((await server.request('/api/auth/me/tour-completed', { method: 'POST' })).status, 200);
    assert.deepEqual(calls, ['owner@example.com']);
  });
  await withApp({ user: null, services }, async (server) => {
    assert.equal((await server.request('/api/auth/me/tour-completed', { method: 'POST' })).status, 401);
  });
});

test('the owner’s viewingAs choice becomes the request’s data scope', async () => {
  const calls = [];
  const services = {
    shootService: {
      list: async (query, scope) => {
        calls.push(scope);
        return [];
      }
    }
  };
  await withApp({ services }, async (server) => {
    await server.request('/api/shoots?viewingAs=other@example.com');
    await server.request('/api/shoots');
    assert.equal(calls[0].targetId, 2, 'the chosen account is the read target');
    assert.equal(calls[0].writeId, 2, '…and the write target, while an owner is viewing');
    assert.equal(calls[0].selfId, 1, 'the signed-in owner is still who they are');
    assert.equal(calls[1].targetId, 1, 'no choice → own data');
    assert.equal(calls[1].writeId, 1, '…and writes stay on the owner’s own data');
  });

  await withApp({ user: { id: 2, email: 'member@example.com', name: 'M', role: 'member' }, services }, async (server) => {
    await server.request('/api/shoots?viewingAs=owner@example.com');
    assert.equal(calls[2].targetId, 2, 'a member’s viewingAs is ignored, not honoured');
  });
});

test('shoots CRUD maps to service calls and status codes', async () => {
  const calls = [];
  const services = {
    shootService: {
      list: async (query) => {
        calls.push(['list', query]);
        return [{ id: 1, title: 'Shoot' }];
      },
      getDetail: async (id) => {
        calls.push(['getDetail', id]);
        return { id, title: 'Shoot', payments: [], media: [] };
      },
      create: async (body) => {
        calls.push(['create', body]);
        return { id: 42 };
      },
      update: async (id, body) => calls.push(['update', id, body]),
      remove: async (id) => calls.push(['remove', id])
    }
  };

  await withApp({ services }, async (server) => {
    const list = await server.request('/api/shoots?month=2026-04&status=planned');
    assert.equal(list.status, 200);
    assert.deepEqual(list.body, [{ id: 1, title: 'Shoot' }]);
    assert.deepEqual(calls[0][1], { month: '2026-04', status: 'planned' });

    assert.equal((await server.request('/api/shoots/7')).body.id, 7);

    const created = await server.request('/api/shoots', { method: 'POST', body: { title: 'New' } });
    assert.equal(created.status, 201);
    assert.deepEqual(created.body, { id: 42 });

    assert.deepEqual((await server.request('/api/shoots/7', { method: 'PUT', body: { fee: 1 } })).body, { ok: true });
    assert.deepEqual((await server.request('/api/shoots/7', { method: 'DELETE' })).body, { ok: true });
    assert.deepEqual(calls.map((call) => call[0]), ['list', 'getDetail', 'create', 'update', 'remove']);
    assert.equal(calls[1][1], 7, 'ids reach the service as numbers');
  });
});

test('a malformed id is a 400, not a database error', async () => {
  await withApp({ services: { shootService: { getDetail: async () => ({}) } } }, async (server) => {
    const response = await server.request('/api/shoots/not-a-number');
    assert.equal(response.status, 400);
    assert.match(response.body.error, /shoot id must be a positive integer/);
  });
});

test('domain errors become their HTTP status with a safe message', async () => {
  const services = {
    shootService: {
      getDetail: async () => {
        throw new NotFoundError();
      },
      create: async () => {
        throw new ValidationError('title and shoot_date are required');
      },
      remove: async () => {
        throw new Error('ECONNREFUSED 10.0.0.5:5432 password=hunter2');
      }
    },
    coordinatorService: {
      remove: async () => {
        throw new ConflictError('coordinator has 3 shoot(s) and cannot be deleted');
      }
    },
    metadataService: {
      describe: async () => {
        throw new ServiceUnavailableError('Could not read the app_users table');
      }
    }
  };

  await withApp({ services }, async (server) => {
    assert.deepEqual(await pick(server.request('/api/shoots/1')), [404, 'not found']);
    assert.deepEqual(
      await pick(server.request('/api/shoots', { method: 'POST', body: {} })),
      [400, 'title and shoot_date are required']
    );
    assert.deepEqual(
      await pick(server.request('/api/coordinators/1', { method: 'DELETE' })),
      [409, 'coordinator has 3 shoot(s) and cannot be deleted']
    );
    assert.deepEqual(await pick(server.request('/api/meta')), [503, 'Could not read the app_users table']);

    const leaky = await server.request('/api/shoots/1', { method: 'DELETE' });
    assert.equal(leaky.status, 500);
    assert.deepEqual(leaky.body, { error: 'Internal server error' }, 'internals never reach the client');
  });

  async function pick(promise) {
    const response = await promise;
    return [response.status, response.body.error];
  }
});

test('payments and media hang off their shoot', async () => {
  const services = {
    paymentService: { record: async (shootId, body) => ({ id: 5, shootId, amount: body.amount }), remove: async () => {} },
    mediaService: { attach: async (shootId, body) => ({ id: 6, shootId, url: body.file_url }), remove: async () => {} }
  };
  await withApp({ services }, async (server) => {
    const payment = await server.request('/api/shoots/3/payments', { method: 'POST', body: { amount: 100 } });
    assert.equal(payment.status, 201);
    assert.deepEqual(payment.body, { id: 5, shootId: 3, amount: 100 });
    assert.deepEqual((await server.request('/api/payments/5', { method: 'DELETE' })).body, { ok: true });

    const media = await server.request('/api/shoots/3/media', { method: 'POST', body: { file_url: 'https://x' } });
    assert.equal(media.status, 201);
    assert.deepEqual((await server.request('/api/media/6', { method: 'DELETE' })).body, { ok: true });
  });
});

test('only owners may reach the access endpoints', async () => {
  const services = {
    accessService: {
      list: async () => [{ id: 1, email: 'owner@example.com', role: 'owner', is_active: true }],
      add: async (body) => ({ id: 2, ...body }),
      update: async (id, patch, context) => ({ id, ...patch, actor: context.actor.email }),
      remove: async (id) => ({ id, email: 'gone@example.com' })
    }
  };

  await withApp({ services, user: { email: 'member@example.com', name: 'M', role: 'member' } }, async (server) => {
    for (const [method, path] of [['GET', '/api/users'], ['POST', '/api/users'], ['PATCH', '/api/users/1'], ['DELETE', '/api/users/1']]) {
      const response = await server.request(path, { method, body: method === 'GET' ? undefined : {} });
      assert.equal(response.status, 403, `${method} ${path}`);
      assert.equal(response.body.error, 'Only an owner can manage access');
    }
  });

  await withApp({ services }, async (server) => {
    assert.equal((await server.request('/api/users')).body.users.length, 1);
    const created = await server.request('/api/users', { method: 'POST', body: { email: 'new@example.com' } });
    assert.equal(created.status, 201);
    assert.equal(created.body.user.email, 'new@example.com');

    const patched = await server.request('/api/users/1', { method: 'PATCH', body: { is_active: false } });
    assert.equal(patched.body.user.actor, 'owner@example.com', 'the actor is passed to the policy');
    assert.deepEqual((await server.request('/api/users/1', { method: 'DELETE' })).body.removed.id, '1');
  });
});

test('an owner can switch another account’s role through the API', async () => {
  const { AccessService } = require('../../server/services/access-service');
  const { UserDirectory } = require('../../server/services/user-directory');
  const { FakeUserRepository, noopSchemaInitializer } = require('../helpers/fakes');

  const userRepository = new FakeUserRepository([
    { id: 1, email: 'owner@example.com', role: 'owner' },
    { id: 2, email: 'second@example.com', role: 'owner' },
    { id: 3, email: 'member@example.com', role: 'member' }
  ]);
  const userDirectory = new UserDirectory({ userRepository, schemaInitializer: noopSchemaInitializer });
  const services = {
    accessService: new AccessService({
      userRepository,
      userDirectory,
      schemaInitializer: noopSchemaInitializer
    })
  };

  await withApp({ services }, async (server) => {
    // signed-in account is owner@example.com (id 1)
    const promote = await server.request('/api/users/3', { method: 'PATCH', body: { role: 'owner' } });
    assert.equal(promote.status, 200);
    assert.equal(promote.body.user.role, 'owner');

    const demote = await server.request('/api/users/2', { method: 'PATCH', body: { role: 'member' } });
    assert.equal(demote.status, 200);
    assert.equal(demote.body.user.role, 'member');

    const selfChange = await server.request('/api/users/1', { method: 'PATCH', body: { role: 'member' } });
    assert.equal(selfChange.status, 403);
    assert.match(selfChange.body.error, /your own role/);

    const badRole = await server.request('/api/users/3', { method: 'PATCH', body: { role: 'superuser' } });
    assert.equal(badRole.status, 400);
    assert.match(badRole.body.error, /role must be one of/);

    const added = await server.request('/api/users', { method: 'POST', body: { email: 'fresh@example.com', role: 'owner' } });
    assert.equal(added.status, 201);
    assert.equal(added.body.user.role, 'member', 'a sent role is ignored — people join as members');

    const rows = await userRepository.list();
    assert.equal(rows.find((row) => row.id === 2).role, 'member', 'the demotion reached the row');
    assert.equal(rows.find((row) => row.id === 3).role, 'owner', 'the promotion reached the row');
  });
});

test('import accepts JSON envelopes and raw text bodies', async () => {
  const seen = [];
  const services = {
    importService: {
      execute: async (request) => {
        seen.push(request);
        return { dryRun: request.dryRun, format: 'csv', count: 1, rows: [], unmapped: [], problems: [] };
      }
    }
  };
  await withApp({ services }, async (server) => {
    const json = await server.request('/api/import', { method: 'POST', body: { content: 'a,b', dryRun: true } });
    assert.equal(json.status, 200);
    assert.equal(json.body.dryRun, true);

    const raw = await server.request('/api/import', {
      method: 'POST',
      body: 'Date,Fee\n2026-04-02,100',
      headers: { 'Content-Type': 'text/csv' }
    });
    assert.equal(raw.status, 200);
    assert.equal(seen[1].content, 'Date,Fee\n2026-04-02,100', 'raw bodies survive the text parser');

    const empty = await server.request('/api/import', { method: 'POST', body: {} });
    assert.equal(empty.status, 400);
    assert.match(empty.body.error, /send raw file content/);
  });
});

test('health, meta and dashboard return their documented shapes', async () => {
  const services = {
    healthService: { check: async () => ({ ok: true, detail: 'connected', latencyMs: 3, time: '2026-01-01T00:00:00.000Z' }) },
    metadataService: { describe: async () => ({ statuses: ['planned', 'completed'], coordinators: [], clients: [], types: [], months: [] }) },
    dashboardService: { summarize: async (query) => ({ kpi: { shoots: 1 }, monthly: [], byCoordinator: [], byType: [], byStatus: [], upcoming: [], echo: query }) }
  };
  await withApp({ services }, async (server) => {
    const health = await server.request('/api/health');
    assert.equal(health.body.ok, true);
    assert.equal(health.headers.get('cache-control'), 'no-store');

    assert.deepEqual((await server.request('/api/meta')).body.statuses, ['planned', 'completed']);

    const dashboard = await server.request('/api/dashboard?month=2026-04');
    assert.equal(dashboard.body.kpi.shoots, 1);
    assert.deepEqual(dashboard.body.echo, { month: '2026-04' });
  });
});

test('unknown API paths are JSON 404s, not HTML', async () => {
  await withApp({}, async (server) => {
    const response = await server.request('/api/nope');
    assert.equal(response.status, 404);
    assert.deepEqual(response.body, { error: 'not found' });
  });
});

test('the app shell is served to members and the login page to visitors', async () => {
  await withApp({}, async (server) => {
    const page = await server.request('/');
    assert.equal(page.status, 200);
    assert.match(page.body, /id="view-dashboard"/);
    assert.match(page.body, /class="tabbar"/, 'the floating navigation is part of the shell');
    assert.match(page.body, /id="view-profile"/, 'profile is a view, not a popup');
    assert.match(page.body, /id="app-loader"/, 'the boot splash is painted before any script runs');
    assert.match(page.body, /id="btn-new-shoot-fab"/, 'so is the floating action button');
    assert.equal(page.headers.get('cache-control'), 'no-store');
  });

  await withApp({ user: null }, async (server) => {
    const page = await server.request('/');
    assert.match(page.body, /google-button/, 'signed-out visitors get the sign-in page');
  });
});

test('app assets are not downloadable without a session', async () => {
  await withApp({ user: null }, async (server) => {
    for (const asset of ['/js/app.js', '/js/app/main.js', '/css/app.css']) {
      const response = await server.request(asset);
      assert.equal(response.status, 401, asset);
      assert.equal(response.body, 'Sign-in required');
    }
    assert.equal((await server.request('/css/login.css')).status, 200, 'the login page keeps working');
  });

  await withApp({}, async (server) => {
    assert.equal((await server.request('/css/app.css')).status, 200);
  });
});

test('security headers are present on every response', async () => {
  await withApp({ user: null }, async (server) => {
    const response = await server.request('/');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    assert.equal(response.headers.get('x-powered-by'), null, 'the framework is not advertised');
  });

  await withApp({ user: null, env: { FRAME_OPTIONS: 'none' } }, async (server) => {
    assert.equal((await server.request('/')).headers.get('x-frame-options'), null, 'framing can be allowed on purpose');
  });
});
