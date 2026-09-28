'use strict';

const { asyncHandler } = require('../../core/async-handler');
const { UnauthorizedError } = require('../../core/errors');
const { AccessPolicy } = require('../../domain/access-policy');

/**
 * Request-level authentication.
 *
 * The middleware only *applies* the decision made by
 * {@link AuthenticationService}; it holds no session or allow-list logic of its
 * own, which keeps Express out of the security rules and the rules testable
 * without Express.
 *
 * @param {{ authenticationService: import('../../services/authentication-service').AuthenticationService }} deps
 */
function createAuthenticationMiddleware({ authenticationService }) {
  /** 401 unless a valid session belongs to an active account. */
  const requireUser = asyncHandler(async (req, _res, next) => {
    const user = await authenticationService.resolveCurrentUser(req);
    if (!user) throw new UnauthorizedError();
    req.user = user;
    next();
  });

  /**
   * Sets `req.user` when possible and never fails — used where being signed out
   * is a normal case (serving the login page instead of the app).
   */
  const attachUserIfPresent = async (req, _res, next) => {
    try {
      req.user = await authenticationService.resolveCurrentUser(req);
    } catch {
      req.user = null; // e.g. the database is unreachable: treat as signed out
    }
    next();
  };

  /** 403 unless the caller owns the workspace. */
  const requireOwner = (req, _res, next) => {
    AccessPolicy.assertCanManageAccess(req.user);
    next();
  };

  return { requireUser, attachUserIfPresent, requireOwner };
}

module.exports = { createAuthenticationMiddleware };
