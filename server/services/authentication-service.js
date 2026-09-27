'use strict';

const { AppError, ForbiddenError, ServiceUnavailableError, UnauthorizedError } = require('../core/errors');
const { silentLogger } = require('../core/logger');

const NOT_ALLOWED = 'This Google account is not allowed to access ShootingTracker';
const NOT_VERIFIED = 'Google sign-in could not be verified. Please try again.';
const NOT_CONFIGURED = 'Google sign-in is not configured. Set GOOGLE_CLIENT_ID on the server.';

/**
 * Sign-in and "who is calling?" in one place.
 *
 * Two independent checks, deliberately kept apart:
 *  1. the identity provider proves *who* the visitor is;
 *  2. the allow-list decides whether that person may come in, on every request
 *     — so revoking access takes effect without invalidating cookies.
 */
class AuthenticationService {
  /**
   * @param {{ identityVerifier: import('./google-identity-verifier').GoogleIdentityVerifier,
   *           userDirectory: import('./user-directory').UserDirectory,
   *           sessionService: import('./session-service').SessionService,
   *           googleClientId?: string|null, logger?: object }} deps
   */
  constructor({ identityVerifier, userDirectory, sessionService, googleClientId, devSignInEmail, logger = silentLogger }) {
    this.identityVerifier = identityVerifier;
    this.userDirectory = userDirectory;
    this.sessionService = sessionService;
    this.googleClientId = googleClientId || null;
    this.devSignInEmail = devSignInEmail || null;
    this.logger = logger;
  }

  get isGoogleConfigured() {
    return Boolean(this.googleClientId);
  }

  /** Public configuration for the sign-in page (the client id is public by design). */
  describeClientConfig() {
    return { clientId: this.googleClientId };
  }

  /**
   * Exchange a Google credential for an app session.
   *
   * @param {string} credential
   * @returns {Promise<{ user: { email: string, name: string }, token: string }>}
   */
  async signInWithGoogle(credential) {
    if (!this.isGoogleConfigured) throw new ServiceUnavailableError(NOT_CONFIGURED);

    const identity = await this.#verifyIdentity(credential);
    if (!(await this.userDirectory.isAllowed(identity.email))) throw new ForbiddenError(NOT_ALLOWED);

    return { user: identity, token: this.sessionService.issue(identity) };
  }

  /**
   * Resolve the caller of a request.
   *
   * @returns {Promise<{ email: string, name: string, role: string }|null>}
   *          null when there is no valid session or the account is not active
   */
  async resolveCurrentUser(req) {
    const session = this.sessionService.fromRequest(req) || this.#developmentSession();
    if (!session) return null;
    const account = await this.userDirectory.lookup(session.email);
    if (!account || !account.is_active) return null;
    return { email: session.email, name: session.name || account.name, role: account.role };
  }

  /**
   * Stand-in session for local development (`DEV_SIGN_IN_EMAIL`). The account
   * still has to be active in the allow-list, and `loadConfig` refuses the
   * setting in production.
   */
  #developmentSession() {
    return this.devSignInEmail ? { email: this.devSignInEmail, name: null } : null;
  }

  /** Verification details are logged, never returned: they only help an attacker. */
  async #verifyIdentity(credential) {
    try {
      return await this.identityVerifier.verify(credential);
    } catch (error) {
      // a database outage is a server problem, not a bad credential
      if (error instanceof AppError && error.status >= 500) throw error;
      this.logger.warn('google credential rejected:', error.message);
      throw new UnauthorizedError(NOT_VERIFIED);
    }
  }
}

module.exports = { AuthenticationService, NOT_ALLOWED, NOT_VERIFIED, NOT_CONFIGURED };
