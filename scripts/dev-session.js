'use strict';

// Mints a signed session cookie for local testing, so scripts can call the API
// without going through Google sign-in.
//
//   node scripts/dev-session.js [email]           → prints "name=value"
//   ST_COOKIE=$(node scripts/dev-session.js) python3 scripts/api-test.py
//
// It only works when the caller knows SESSION_SECRET, and the account still has
// to exist and be active in app_users — the allow-list is checked on every
// request, so this is a convenience, not a bypass.

const { loadConfig, loadEnvFile } = require('../server/config');
const { SessionService } = require('../server/services/session-service');

const config = loadConfig(loadEnvFile());
const email = process.argv[2] || process.env.DEV_SESSION_EMAIL || 'sumit2nandi@gmail.com';

const sessions = new SessionService({
  secret: config.auth.sessionSecret,
  cookieName: config.auth.sessionCookieName,
  ttlSeconds: config.auth.sessionTtlSeconds
});

if (!config.auth.sessionSecretProvided) {
  console.error('warning: SESSION_SECRET is not set, so this cookie will not match a server started separately');
}
process.stdout.write(`${config.auth.sessionCookieName}=${sessions.issue({ email, name: email.split('@')[0] })}\n`);
