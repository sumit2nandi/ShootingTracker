'use strict';

const crypto = require('crypto');
const { UnauthorizedError } = require('../core/errors');

const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
const MIN_KEY_CACHE_SECONDS = 60;
const MAX_KEY_CACHE_SECONDS = 3600;

/**
 * Verifies Google Identity Services ID tokens (RS256 JWTs).
 *
 * `fetch` and the clock are injected, so the whole verification path —
 * signature, issuer, audience, expiry, `email_verified` — is unit-testable with
 * a locally generated key pair and no network.
 */
class GoogleIdentityVerifier {
  /**
   * @param {{ clientId: string|null, certsUrl?: string,
   *           fetchImpl?: typeof fetch, clock?: () => number }} options
   */
  constructor({ clientId, certsUrl = 'https://www.googleapis.com/oauth2/v3/certs', fetchImpl, clock = Date.now }) {
    this.clientId = clientId;
    this.certsUrl = certsUrl;
    this.fetchImpl = fetchImpl || ((...args) => fetch(...args));
    this.clock = clock;
    this.keys = null;
    this.keysExpireAt = 0;
  }

  /**
   * @param {string} credential the ID token from the Google button
   * @returns {Promise<{ email: string, name: string }>}
   * @throws {UnauthorizedError} for any malformed, unsigned or expired token
   */
  async verify(credential) {
    if (!credential || typeof credential !== 'string' || !this.clientId) {
      throw new UnauthorizedError('Google sign-in is not configured');
    }
    const parts = credential.split('.');
    if (parts.length !== 3) throw new UnauthorizedError('Invalid Google credential');

    let header;
    let claims;
    try {
      header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
      claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch {
      throw new UnauthorizedError('Invalid Google credential');
    }
    if (header.alg !== 'RS256' || !header.kid) throw new UnauthorizedError('Unsupported Google credential');

    const key = await this.#findKey(header.kid);
    this.#assertSignature(parts, key);
    this.#assertClaims(claims);

    const email = String(claims.email || '').trim().toLowerCase();
    return { email, name: String(claims.name || email.split('@')[0]).slice(0, 120) };
  }

  /** Google rotates signing keys: a miss forces one cache refresh before failing. */
  async #findKey(kid) {
    const matches = (candidate) => candidate.kid === kid && candidate.kty === 'RSA';
    const found = (await this.#signingKeys()).find(matches);
    if (found) return found;

    this.keys = null;
    this.keysExpireAt = 0;
    const refreshed = (await this.#signingKeys()).find(matches);
    if (!refreshed) throw new UnauthorizedError('Google credential signing key not found');
    return refreshed;
  }

  async #signingKeys() {
    if (this.keys && this.clock() < this.keysExpireAt) return this.keys;
    const response = await this.fetchImpl(this.certsUrl);
    if (!response.ok) throw new Error('Could not retrieve Google signing keys');
    const body = await response.json();
    const cacheControl = (response.headers && response.headers.get('cache-control')) || '';
    const maxAge = Number((cacheControl.match(/max-age=(\d+)/i) || [])[1] || 300);
    this.keys = body.keys || [];
    this.keysExpireAt =
      this.clock() + Math.max(MIN_KEY_CACHE_SECONDS, Math.min(maxAge, MAX_KEY_CACHE_SECONDS)) * 1000;
    return this.keys;
  }

  #assertSignature(parts, key) {
    const verified = crypto.verify(
      'RSA-SHA256',
      Buffer.from(`${parts[0]}.${parts[1]}`),
      crypto.createPublicKey({ key, format: 'jwk' }),
      Buffer.from(parts[2], 'base64url')
    );
    if (!verified) throw new UnauthorizedError('Invalid Google credential signature');
  }

  #assertClaims(claims) {
    const now = Math.floor(this.clock() / 1000);
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    const emailVerified = claims.email_verified === true || claims.email_verified === 'true';
    const valid =
      GOOGLE_ISSUERS.includes(claims.iss) &&
      audiences.includes(this.clientId) &&
      Number.isFinite(claims.exp) &&
      claims.exp > now &&
      !(claims.iat && claims.iat > now + 60) &&
      emailVerified;
    if (!valid) throw new UnauthorizedError('Google credential is invalid or expired');
  }
}

module.exports = { GoogleIdentityVerifier, GOOGLE_ISSUERS };
