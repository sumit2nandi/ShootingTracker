'use strict';

const express = require('express');
const { asyncHandler } = require('../../core/async-handler');
const { noStore } = require('../middleware/security-headers');

/**
 * `/api/auth/*` — the only endpoints reachable without a session.
 *
 * @param {{ authenticationService: import('../../services/authentication-service').AuthenticationService,
 *           sessionService: import('../../services/session-service').SessionService,
 *           requireUser: import('express').RequestHandler }} deps
 */
function createAuthRouter({ authenticationService, sessionService, requireUser }) {
  const router = express.Router();
  router.use(noStore);

  router.get('/config', (_req, res) => {
    res.json(authenticationService.describeClientConfig());
  });

  router.get('/me', requireUser, (req, res) => {
    res.json({ user: req.user });
  });

  router.post(
    '/google',
    asyncHandler(async (req, res) => {
      const { user, token } = await authenticationService.signInWithGoogle(req.body && req.body.credential);
      res.cookie(sessionService.cookieName, token, sessionService.cookieOptions(req));
      res.json({ user });
    })
  );

  router.post('/logout', (req, res) => {
    res.clearCookie(sessionService.cookieName, sessionService.cookieOptions(req, 0));
    res.json({ ok: true });
  });

  return router;
}

module.exports = { createAuthRouter };
