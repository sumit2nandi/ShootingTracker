'use strict';

const express = require('express');
const { asyncHandler } = require('../../core/async-handler');
const { noStore } = require('../middleware/security-headers');

/**
 * `/api/auth/*` — sign-in, consent, and "who am I".
 *
 * `/google` and `/consent` are the only endpoints reachable without a session;
 * the rest need one.
 *
 * @param {{ authenticationService: import('../../services/authentication-service').AuthenticationService,
 *           accessService: import('../../services/access-service').AccessService,
 *           sessionService: import('../../services/session-service').SessionService,
 *           requireUser: import('express').RequestHandler }} deps
 */
function createAuthRouter({ authenticationService, accessService, sessionService, requireUser }) {
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
      const { user, token, needsConsent } = await authenticationService.signInWithGoogle(
        req.body && req.body.credential
      );
      if (token) res.cookie(sessionService.cookieName, token, sessionService.cookieOptions(req));
      res.json(needsConsent ? { user, needsConsent: true } : { user });
    })
  );

  router.post(
    '/consent',
    asyncHandler(async (req, res) => {
      const body = req.body || {};
      const { user, token } = await authenticationService.acceptConsent(body.credential, body.name);
      res.cookie(sessionService.cookieName, token, sessionService.cookieOptions(req));
      res.json({ user });
    })
  );

  router.post(
    '/me/tour-completed',
    requireUser,
    asyncHandler(async (req, res) => {
      await accessService.markTourCompleted(req.user.email);
      res.json({ ok: true });
    })
  );

  router.post('/logout', (req, res) => {
    res.clearCookie(sessionService.cookieName, sessionService.cookieOptions(req, 0));
    res.json({ ok: true });
  });

  return router;
}

module.exports = { createAuthRouter };
