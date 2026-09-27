'use strict';

const crypto = require('crypto');
const path = require('path');
const { ConfigurationError } = require('../core/errors');

const DEFAULT_PORT = 3000;
const DEFAULT_BODY_LIMIT = '15mb';
const SEVEN_DAYS_IN_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_ALLOWLIST_CACHE_MS = 20_000;

/** Reads `.env` into `process.env`. Kept separate so tests never touch the file system. */
function loadEnvFile() {
  require('dotenv').config();
  return process.env;
}

function readPort(raw) {
  if (raw === undefined || raw === '') return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigurationError(`PORT must be an integer between 1 and 65535 (received "${raw}")`);
  }
  return port;
}

function readLogLevel(raw, isProduction) {
  const level = String(raw || (isProduction ? 'info' : 'debug')).toLowerCase();
  const allowed = ['silent', 'error', 'warn', 'info', 'debug'];
  if (!allowed.includes(level)) {
    throw new ConfigurationError(`LOG_LEVEL must be one of ${allowed.join(', ')} (received "${raw}")`);
  }
  return level;
}

/**
 * Turn raw environment variables into one frozen, validated configuration
 * object. Nothing else in the codebase reads `process.env`, so every setting is
 * discoverable here and overridable in tests.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Readonly<object>}
 */
function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';
  const sessionSecret = env.SESSION_SECRET || null;

  const config = {
    nodeEnv,
    isProduction,
    port: readPort(env.PORT),
    logLevel: readLogLevel(env.LOG_LEVEL, isProduction),
    database: {
      url: env.DATABASE_URL || '',
      connectionTimeoutMillis: Number(env.DB_CONNECTION_TIMEOUT_MS || 10_000),
      idleTimeoutMillis: Number(env.DB_IDLE_TIMEOUT_MS || 30_000),
      maxClients: Number(env.DB_POOL_MAX || 10),
      healthCheckTimeoutMs: Number(env.DB_HEALTHCHECK_TIMEOUT_MS || 5_000)
    },
    auth: {
      googleClientId: env.GOOGLE_CLIENT_ID || null,
      // A generated secret keeps development working; sessions then reset on
      // every restart, which the bootstrap warns about.
      sessionSecret: sessionSecret || crypto.randomBytes(32).toString('hex'),
      sessionSecretProvided: Boolean(sessionSecret),
      sessionCookieName: env.SESSION_COOKIE_NAME || 'shootingtracker_session',
      sessionTtlSeconds: Number(env.SESSION_TTL_SECONDS || SEVEN_DAYS_IN_SECONDS),
      allowlistCacheMs: Number(env.ALLOWLIST_CACHE_MS || DEFAULT_ALLOWLIST_CACHE_MS),
      googleCertsUrl: env.GOOGLE_CERTS_URL || 'https://www.googleapis.com/oauth2/v3/certs',
      /**
       * Development escape hatch: treat every request as this account, so the
       * app can be opened without Google credentials. The account must still
       * exist and be active in `app_users`, and production refuses to start
       * with it set (checked below).
       */
      devSignInEmail: env.DEV_SIGN_IN_EMAIL || null
    },
    http: {
      bodyLimit: env.BODY_LIMIT || DEFAULT_BODY_LIMIT,
      trustProxy: env.TRUST_PROXY === undefined ? 1 : env.TRUST_PROXY,
      staticDir: path.join(__dirname, '..', '..', 'public'),
      /** `none` omits X-Frame-Options, for deployments that are embedded on purpose. */
      frameOptions: env.FRAME_OPTIONS || 'SAMEORIGIN',
      /** Assets that must not be downloadable before a session exists. */
      protectedAssetPrefixes: ['/css/app.css', '/js/app']
    },
    limits: {
      shootListMaxRows: Number(env.SHOOT_LIST_MAX_ROWS || 2000)
    }
  };

  if (!Number.isFinite(config.auth.sessionTtlSeconds) || config.auth.sessionTtlSeconds <= 0) {
    throw new ConfigurationError('SESSION_TTL_SECONDS must be a positive number of seconds');
  }
  if (!Number.isFinite(config.limits.shootListMaxRows) || config.limits.shootListMaxRows <= 0) {
    throw new ConfigurationError('SHOOT_LIST_MAX_ROWS must be a positive integer');
  }
  if (isProduction && config.auth.devSignInEmail) {
    throw new ConfigurationError('DEV_SIGN_IN_EMAIL must not be set when NODE_ENV=production');
  }

  return Object.freeze({
    ...config,
    database: Object.freeze(config.database),
    auth: Object.freeze(config.auth),
    http: Object.freeze({ ...config.http, protectedAssetPrefixes: Object.freeze(config.http.protectedAssetPrefixes) }),
    limits: Object.freeze(config.limits)
  });
}

module.exports = { loadConfig, loadEnvFile, DEFAULT_PORT, SEVEN_DAYS_IN_SECONDS };
