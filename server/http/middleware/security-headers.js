'use strict';

/**
 * Baseline security headers, set in one place for every response.
 *
 * Deliberately dependency-free (no helmet) to keep the zero-build, few-deps
 * promise of the project; the directives below are the subset that actually
 * applies to a same-origin SPA talking to its own JSON API.
 *
 * @param {{ frameOptions?: string }} [options]
 *        `frameOptions: 'none'` omits the framing header — needed when the app
 *        is intentionally embedded (preview environments, an internal portal).
 */
function createSecurityHeaders({ frameOptions = 'SAMEORIGIN' } = {}) {
  const frameHeader = String(frameOptions).toLowerCase() === 'none' ? null : frameOptions;
  return function securityHeaders(_req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (frameHeader) res.setHeader('X-Frame-Options', frameHeader);
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups'); // Google sign-in opens a popup
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    next();
  };
}

/** Responses that must never be cached (auth state, live data). */
function noStore(_req, res, next) {
  res.set('Cache-Control', 'no-store');
  next();
}

module.exports = { createSecurityHeaders, noStore };
