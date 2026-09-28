'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { SessionService } = require('../../server/services/session-service');
const { GoogleIdentityVerifier } = require('../../server/services/google-identity-verifier');
const { AuthenticationService } = require('../../server/services/authentication-service');
const { UnauthorizedError, ForbiddenError, ServiceUnavailableError } = require('../../server/core/errors');

/* ---------------- sessions ---------------- */

const sessionService = (overrides = {}) =>
  new SessionService({ secret: 'unit-test-secret', ttlSeconds: 3600, ...overrides });

test('a freshly issued session round-trips', () => {
  const sessions = sessionService();
  const session = sessions.read(sessions.issue({ email: 'a@example.com', name: 'A' }));
  assert.deepEqual(session, { email: 'a@example.com', name: 'A' });
});

test('a tampered payload is rejected', () => {
  const sessions = sessionService();
  const [, signature] = sessions.issue({ email: 'a@example.com', name: 'A' }).split('.');
  const forged = Buffer.from(JSON.stringify({ email: 'evil@example.com', exp: 9e9 })).toString('base64url');
  assert.equal(sessions.read(`${forged}.${signature}`), null);
});

test('a session signed with another secret is rejected', () => {
  const token = sessionService({ secret: 'other-secret' }).issue({ email: 'a@example.com', name: 'A' });
  assert.equal(sessionService().read(token), null);
});

test('an expired session is rejected', () => {
  let now = 1_000_000_000_000;
  const sessions = sessionService({ ttlSeconds: 60, clock: () => now });
  const token = sessions.issue({ email: 'a@example.com', name: 'A' });
  now += 61_000;
  assert.equal(sessions.read(token), null);
});

test('malformed tokens never throw', () => {
  const sessions = sessionService();
  for (const token of ['', 'nonsense', 'a.b.c', '...', null, undefined]) {
    assert.equal(sessions.read(token), null);
  }
});

test('the session cookie is read out of the Cookie header', () => {
  const sessions = sessionService({ cookieName: 'st_session' });
  const token = sessions.issue({ email: 'a@example.com', name: 'A' });
  const req = { headers: { cookie: `other=1; st_session=${token}; another=2` } };
  assert.equal(sessions.fromRequest(req).email, 'a@example.com');
  assert.equal(sessions.fromRequest({ headers: {} }), null);
});

test('cookies are http-only, same-site and secure in production', () => {
  const dev = sessionService().cookieOptions({ secure: false });
  assert.equal(dev.httpOnly, true);
  assert.equal(dev.sameSite, 'lax');
  assert.equal(dev.secure, false);
  assert.equal(sessionService({ isProduction: true }).cookieOptions({ secure: false }).secure, true);
  assert.equal(sessionService().cookieOptions({ secure: true }).secure, true, 'honours a TLS-terminating proxy');
});

/* ---------------- Google ID tokens ---------------- */

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' };
const CLIENT_ID = 'client-id.apps.googleusercontent.com';

function signIdToken(claims, { kid = 'test-key', alg = 'RS256' } = {}) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const body = `${encode({ alg, kid })}.${encode(claims)}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(body), privateKey).toString('base64url');
  return `${body}.${signature}`;
}

function validClaims(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    email: 'Person@Example.com',
    email_verified: true,
    name: 'Person',
    iat: now - 10,
    exp: now + 600,
    ...overrides
  };
}

function verifierWithKeys(keys = [jwk]) {
  let fetches = 0;
  const verifier = new GoogleIdentityVerifier({
    clientId: CLIENT_ID,
    fetchImpl: async () => {
      fetches++;
      return {
        ok: true,
        json: async () => ({ keys }),
        headers: { get: () => 'public, max-age=3600' }
      };
    }
  });
  return { verifier, fetchCount: () => fetches };
}

test('a correctly signed token yields a normalized identity', async () => {
  const { verifier, fetchCount } = verifierWithKeys();
  const identity = await verifier.verify(signIdToken(validClaims()));
  assert.deepEqual(identity, { email: 'person@example.com', name: 'Person' });

  await verifier.verify(signIdToken(validClaims()));
  assert.equal(fetchCount(), 1, 'signing keys are cached');
});

test('tokens failing any claim check are rejected', async () => {
  const cases = {
    'wrong audience': { aud: 'someone-else' },
    'wrong issuer': { iss: 'https://evil.example.com' },
    expired: { exp: Math.floor(Date.now() / 1000) - 1 },
    'issued in the future': { iat: Math.floor(Date.now() / 1000) + 600 },
    'unverified email': { email_verified: false }
  };
  for (const [name, overrides] of Object.entries(cases)) {
    const { verifier } = verifierWithKeys();
    await assert.rejects(verifier.verify(signIdToken(validClaims(overrides))), UnauthorizedError, name);
  }
});

test('a token signed by an unknown key is rejected after one key refresh', async () => {
  const { verifier, fetchCount } = verifierWithKeys([{ ...jwk, kid: 'another-key' }]);
  await assert.rejects(verifier.verify(signIdToken(validClaims())), /signing key not found/);
  assert.equal(fetchCount(), 2, 'keys are refetched once in case Google rotated them');
});

test('a tampered signature is rejected', async () => {
  const { verifier } = verifierWithKeys();
  const [header, payload] = signIdToken(validClaims()).split('.');
  const forged = Buffer.from(JSON.stringify(validClaims({ email: 'evil@example.com' }))).toString('base64url');
  await assert.rejects(verifier.verify(`${header}.${forged}.${payload}`), UnauthorizedError);
});

test('non-RS256 tokens are refused outright', async () => {
  const { verifier } = verifierWithKeys();
  await assert.rejects(verifier.verify(signIdToken(validClaims(), { alg: 'none' })), /Unsupported/);
  await assert.rejects(verifier.verify('not.a.jwt'), UnauthorizedError);
  await assert.rejects(verifier.verify(''), UnauthorizedError);
});

/* ---------------- sign-in flow ---------------- */

function authServiceWith({ allowed = true, verify = async () => ({ email: 'a@example.com', name: 'A' }) } = {}) {
  return new AuthenticationService({
    identityVerifier: { verify },
    userDirectory: {
      isAllowed: async () => allowed,
      lookup: async () => (allowed ? { email: 'a@example.com', role: 'owner', is_active: true, name: 'A' } : null)
    },
    sessionService: sessionService(),
    googleClientId: CLIENT_ID
  });
}

test('sign-in issues a session for an allow-listed account', async () => {
  const { user, token } = await authServiceWith().signInWithGoogle('credential');
  assert.equal(user.email, 'a@example.com');
  assert.ok(token.includes('.'));
});

test('an account outside the allow-list is forbidden, not unauthorized', async () => {
  await assert.rejects(authServiceWith({ allowed: false }).signInWithGoogle('credential'), (error) => {
    assert.ok(error instanceof ForbiddenError);
    assert.match(error.message, /not allowed to access ShootingTracker/);
    return true;
  });
});

test('verification details are replaced by a generic message', async () => {
  const service = authServiceWith({
    verify: async () => {
      throw new UnauthorizedError('kid 42 not in JWKS cache');
    }
  });
  await assert.rejects(service.signInWithGoogle('credential'), (error) => {
    assert.equal(error.status, 401);
    assert.equal(error.message, 'Google sign-in could not be verified. Please try again.');
    return true;
  });
});

test('a database outage during sign-in is not reported as a bad credential', async () => {
  const service = authServiceWith({
    verify: async () => {
      throw new ServiceUnavailableError('allow-list unreachable');
    }
  });
  await assert.rejects(service.signInWithGoogle('credential'), ServiceUnavailableError);
});

test('sign-in is refused when Google is not configured', async () => {
  const service = new AuthenticationService({
    identityVerifier: { verify: async () => ({}) },
    userDirectory: { isAllowed: async () => true },
    sessionService: sessionService(),
    googleClientId: null
  });
  assert.equal(service.isGoogleConfigured, false);
  await assert.rejects(service.signInWithGoogle('x'), /GOOGLE_CLIENT_ID/);
});

test('the current user combines the session with the live account role', async () => {
  const sessions = sessionService();
  const service = new AuthenticationService({
    identityVerifier: { verify: async () => ({}) },
    userDirectory: { lookup: async () => ({ email: 'a@example.com', name: 'Stored', role: 'owner', is_active: true }) },
    sessionService: sessions,
    googleClientId: CLIENT_ID
  });
  const token = sessions.issue({ email: 'a@example.com', name: 'Session Name' });
  const user = await service.resolveCurrentUser({ headers: { cookie: `shootingtracker_session=${token}` } });
  assert.deepEqual(user, { email: 'a@example.com', name: 'Session Name', role: 'owner' });
});

test('a deactivated account has no current user even with a valid cookie', async () => {
  const sessions = sessionService();
  const service = new AuthenticationService({
    identityVerifier: { verify: async () => ({}) },
    userDirectory: { lookup: async () => ({ email: 'a@example.com', role: 'member', is_active: false }) },
    sessionService: sessions,
    googleClientId: CLIENT_ID
  });
  const token = sessions.issue({ email: 'a@example.com', name: 'A' });
  assert.equal(await service.resolveCurrentUser({ headers: { cookie: `shootingtracker_session=${token}` } }), null);
});

test('DEV_SIGN_IN_EMAIL signs in without a cookie but still respects the allow-list', async () => {
  const build = (account) =>
    new AuthenticationService({
      identityVerifier: { verify: async () => ({}) },
      userDirectory: { lookup: async () => account },
      sessionService: sessionService(),
      googleClientId: CLIENT_ID,
      devSignInEmail: 'dev@example.com'
    });

  const active = await build({ email: 'dev@example.com', name: 'Dev', role: 'owner', is_active: true })
    .resolveCurrentUser({ headers: {} });
  assert.deepEqual(active, { email: 'dev@example.com', name: 'Dev', role: 'owner' });

  assert.equal(await build(null).resolveCurrentUser({ headers: {} }), null, 'unknown accounts are still refused');
  assert.equal(
    await build({ email: 'dev@example.com', role: 'member', is_active: false }).resolveCurrentUser({ headers: {} }),
    null,
    'deactivated accounts are still refused'
  );
});

test('production refuses to start with the development bypass enabled', async () => {
  const { loadConfig } = require('../../server/config');
  const { ConfigurationError } = require('../../server/core/errors');
  assert.throws(
    () => loadConfig({ NODE_ENV: 'production', DEV_SIGN_IN_EMAIL: 'dev@example.com' }),
    ConfigurationError
  );
  assert.doesNotThrow(() => loadConfig({ DEV_SIGN_IN_EMAIL: 'dev@example.com' }));
});
