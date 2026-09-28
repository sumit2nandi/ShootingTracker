'use strict';

const crypto = require('crypto');

const base64url = (value) => Buffer.from(value).toString('base64url');

function timingSafeEqual(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/**
 * Stateless, HMAC-signed session cookies.
 *
 * Only two things are guaranteed here: the payload was issued by this server
 * and it has not expired. Whether the account may still use the app is a
 * different question, answered by the user directory — keeping the two apart is
 * what lets access be revoked without invalidating every cookie.
 */
class SessionService {
  /**
   * @param {{ secret: string, cookieName?: string, ttlSeconds?: number,
   *           isProduction?: boolean, clock?: () => number }} options
   */
  constructor({ secret, cookieName = 'shootingtracker_session', ttlSeconds = 7 * 24 * 60 * 60, isProduction = false, clock = Date.now }) {
    if (!secret) throw new TypeError('SessionService requires a secret');
    this.secret = secret;
    this.cookieName = cookieName;
    this.ttlSeconds = ttlSeconds;
    this.isProduction = isProduction;
    this.clock = clock;
  }

  /** @returns {string} a signed `payload.signature` token */
  issue(user) {
    const payload = base64url(
      JSON.stringify({
        email: user.email,
        name: user.name,
        exp: Math.floor(this.clock() / 1000) + this.ttlSeconds
      })
    );
    return `${payload}.${this.#sign(payload)}`;
  }

  /** @returns {{ email: string, name: string }|null} null when missing, tampered or expired */
  read(token) {
    if (!token) return null;
    const [payload, signature, extra] = String(token).split('.');
    if (!payload || !signature || extra) return null;
    if (!timingSafeEqual(signature, this.#sign(payload))) return null;
    try {
      const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (typeof session.email !== 'string' || !session.email) return null;
      if (!Number.isFinite(session.exp) || session.exp <= this.clock() / 1000) return null;
      return { email: session.email, name: session.name };
    } catch {
      return null;
    }
  }

  /** Read the session straight from a request's `Cookie` header. */
  fromRequest(req) {
    const header = String((req && req.headers && req.headers.cookie) || '');
    const prefix = `${this.cookieName}=`;
    const entry = header
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(prefix));
    return this.read(entry ? entry.slice(prefix.length) : null);
  }

  /** @param {number} maxAge cookie lifetime in ms (0 clears it) */
  cookieOptions(req, maxAge = this.ttlSeconds * 1000) {
    return {
      httpOnly: true,
      secure: Boolean((req && req.secure) || this.isProduction),
      sameSite: 'lax',
      path: '/',
      maxAge
    };
  }

  #sign(payload) {
    return crypto.createHmac('sha256', this.secret).update(payload).digest('base64url');
  }
}

module.exports = { SessionService };
