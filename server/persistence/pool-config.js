'use strict';

const { ConfigurationError } = require('../core/errors');

/**
 * Build `pg.Pool` options from a connection URL.
 *
 * We parse the URL ourselves instead of handing `connectionString` to pg:
 * pg >= 8.16 (pg-connection-string) turns `?sslmode=require` into `ssl: {}`,
 * and that object OVERRIDES an explicit `ssl` option (see pg
 * lib/connection-parameters.js: `Object.assign(config, parse(connectionString))`).
 * Node then silently validates the certificate chain, which breaks behind
 * corporate TLS-inspection proxies ("self-signed certificate in certificate
 * chain"). Parsing explicitly keeps `rejectUnauthorized: false` in effect.
 *
 * TLS note: for remote hosts certificate verification is skipped (convenience
 * for a dev tool behind corporate proxies). For strict verification point Node
 * at the issuing CA instead: `NODE_EXTRA_CA_CERTS=/path/to/ca.crt`.
 *
 * @param {string} url
 * @param {{ connectionTimeoutMillis?: number, idleTimeoutMillis?: number, maxClients?: number }} [options]
 */
function buildPoolConfig(url, options = {}) {
  const base = {
    connectionTimeoutMillis: options.connectionTimeoutMillis || 10_000,
    idleTimeoutMillis: options.idleTimeoutMillis || 30_000,
    max: options.maxClients || 10
  };
  if (!url) return base;

  let parsed;
  try {
    parsed = new URL(url);
  } catch (error) {
    throw new ConfigurationError(`DATABASE_URL is not a valid URL: ${error.message}`);
  }

  const isRemote = parsed.hostname.includes('aivencloud.com') || url.includes('sslmode');
  return {
    ...base,
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 5432,
    user: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    database: parsed.pathname.replace(/^\//, '') || undefined,
    ssl: isRemote ? { rejectUnauthorized: false } : undefined
  };
}

module.exports = { buildPoolConfig };
