'use strict';

const crypto = require('crypto');

const ALLOWED_EMAILS = new Set([
  'sumit2nandi@gmail.com',
  'sushmitaghosh0099@gmail.com'
]);
const SESSION_COOKIE = 'shootingtracker_session';
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
let cachedKeys = null;
let keysExpireAt = 0;

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function safeEqual(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

async function googleKeys() {
  if (cachedKeys && Date.now() < keysExpireAt) return cachedKeys;
  const response = await fetch(GOOGLE_CERTS_URL);
  if (!response.ok) throw new Error('Could not retrieve Google signing keys');
  const body = await response.json();
  const cacheControl = response.headers.get('cache-control') || '';
  const maxAge = Number((cacheControl.match(/max-age=(\d+)/i) || [])[1] || 300);
  cachedKeys = body.keys || [];
  keysExpireAt = Date.now() + Math.max(60, Math.min(maxAge, 3600)) * 1000;
  return cachedKeys;
}

async function verifyGoogleCredential(credential, clientId) {
  if (!credential || typeof credential !== 'string' || !clientId) {
    throw new Error('Google sign-in is not configured');
  }
  const parts = credential.split('.');
  if (parts.length !== 3) throw new Error('Invalid Google credential');

  let header;
  let claims;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch (_error) {
    throw new Error('Invalid Google credential');
  }
  if (header.alg !== 'RS256' || !header.kid) throw new Error('Unsupported Google credential');

  const key = (await googleKeys()).find((candidate) => candidate.kid === header.kid && candidate.kty === 'RSA');
  if (!key) {
    cachedKeys = null;
    keysExpireAt = 0;
    const refreshed = (await googleKeys()).find((candidate) => candidate.kid === header.kid && candidate.kty === 'RSA');
    if (!refreshed) throw new Error('Google credential signing key not found');
    return validateClaimsAndSignature(parts, header, claims, refreshed, clientId);
  }
  return validateClaimsAndSignature(parts, header, claims, key, clientId);
}

function validateClaimsAndSignature(parts, header, claims, key, clientId) {
  const publicKey = crypto.createPublicKey({ key, format: 'jwk' });
  const verified = crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${parts[0]}.${parts[1]}`),
    publicKey,
    Buffer.from(parts[2], 'base64url')
  );
  if (!verified) throw new Error('Invalid Google credential signature');

  const now = Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss)
    || !audiences.includes(clientId)
    || !Number.isFinite(claims.exp) || claims.exp <= now
    || (claims.iat && claims.iat > now + 60)
    || claims.email_verified !== true && claims.email_verified !== 'true') {
    throw new Error('Google credential is invalid or expired');
  }
  const email = String(claims.email || '').trim().toLowerCase();
  if (!ALLOWED_EMAILS.has(email)) throw new Error('This Google account is not allowed to access ShootingTracker');
  return { email, name: String(claims.name || email.split('@')[0]).slice(0, 120) };
}

function createSession(user, secret) {
  const payload = base64url(JSON.stringify({
    email: user.email,
    name: user.name,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
  }));
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function readSession(token, secret) {
  if (!token || !secret) return null;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return null;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  if (!safeEqual(signature, expected)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!ALLOWED_EMAILS.has(session.email) || !Number.isFinite(session.exp) || session.exp <= Date.now() / 1000) return null;
    return { email: session.email, name: session.name };
  } catch (_error) {
    return null;
  }
}

function cookieOptions(req, maxAge) {
  return {
    httpOnly: true,
    secure: req.secure || process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge
  };
}

function getSession(req, secret) {
  const cookies = String(req.headers.cookie || '').split(';');
  const entry = cookies.map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  return readSession(entry ? entry.slice(SESSION_COOKIE.length + 1) : null, secret);
}

module.exports = {
  ALLOWED_EMAILS,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  createSession,
  cookieOptions,
  getSession,
  verifyGoogleCredential
};
