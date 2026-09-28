'use strict';

const { AppError, ForbiddenError, ServiceUnavailableError, UnauthorizedError } = require('../core/errors');
const { silentLogger } = require('../core/logger');

const NOT_VERIFIED = 'Google sign-in could not be verified. Please try again.';
const NOT_CONFIGURED = 'Google sign-in is not configured. Set GOOGLE_CLIENT_ID on the server.';
const DEACTIVATED = 'This account has been deactivated. Ask an owner to re-enable it in People with Access.';

/**
 * Sign-in and "who is calling?" in one place.
 *
 * The identity provider proves *who* the visitor is; what happens next depends
 * on the allow-list:
 *  - an active account signs straight in;
 *  - a deactivated account is refused (the owner must re-enable it);
 *  - an account the app has never seen is *not* refused — it is sent back to
 *    the client flagged `needsConsent`, and its profile is created only once
 *    the visitor accepts, via {@link acceptConsent}.
 *
 * Every request afterwards re-checks the allow-list through the user directory,
 * so revoking access takes effect without invalidating cookies.
 */
class AuthenticationService {
  /**
   * @param {{ identityVerifier: import('./google-identity-verifier').GoogleIdentityVerifier,
   *           userDirectory: import('./user-directory').UserDirectory,
   *           accessService: import('./access-service').AccessService,
   *           sessionService: import('./session-service').SessionService,
   *           googleClientId?: string|null, logger?: object }} deps
   */
  constructor({ identityVerifier, userDirectory, accessService, sessionService, googleClientId, devSignInEmail, logger = silentLogger }) {
    this.identityVerifier = identityVerifier;
    this.userDirectory = userDirectory;
    this.accessService = accessService;
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
   * @returns {Promise<{ user: object, token?: string, needsConsent?: boolean }>}
   *          `token` when a session was issued; `needsConsent: true` when the
   *          account is new and must first accept the consent form.
   */
  async signInWithGoogle(credential) {
    if (!this.isGoogleConfigured) throw new ServiceUnavailableError(NOT_CONFIGURED);

    const identity = await this.#verifyIdentity(credential);
    const account = await this.userDirectory.lookup(identity.email);
    if (!account) return { user: identity, needsConsent: true };
    if (!account.is_active) throw new ForbiddenError(DEACTIVATED);

    return { user: identity, token: this.sessionService.issue(identity) };
  }

  /**
   * Complete a first sign-in: the visitor accepted the consent form, so their
   * profile may now exist.
   *
   * The credential is verified again — the client holds it, the server holds
   * no pending state — and the account is created only when it is genuinely
   * new, as a member. An existing active account simply gets a session
   * (someone raced the consent form); a deactivated one stays refused.
   *
   * @param {string} credential
   * @param {string} [name] display name from the form (defaults to Google's)
   * @returns {Promise<{ user: object, token: string }>}
   */
  async acceptConsent(credential, name) {
    if (!this.isGoogleConfigured) throw new ServiceUnavailableError(NOT_CONFIGURED);

    const identity = await this.#verifyIdentity(credential);
    const displayName = (name && String(name).trim()) || identity.name;

    const account = await this.userDirectory.lookup(identity.email);
    if (account) {
      if (!account.is_active) throw new ForbiddenError(DEACTIVATED);
      return { user: identity, token: this.sessionService.issue(identity) };
    }

    const created = await this.accessService.createNewUser({ email: identity.email, name: displayName });
    this.logger.info(`new account created via consent: ${created.email}`);
    return { user: { ...identity, name: created.name || identity.name }, token: this.sessionService.issue(identity) };
  }

  /**
   * Resolve the caller of a request.
   *
   * @returns {Promise<{ id: number, email: string, name: string, role: string, tour_completed: boolean }|null>}
   *          null when there is no valid session or the account is not active
   */
  async resolveCurrentUser(req) {
    const session = this.sessionService.fromRequest(req) || this.#developmentSession();
    if (!session) return null;
    const account = await this.userDirectory.lookup(session.email);
    if (!account || !account.is_active) return null;
    return {
      id: account.id,
      email: session.email,
      name: session.name || account.name,
      role: account.role,
      tour_completed: account.tour_completed !== false
    };
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

module.exports = { AuthenticationService, NOT_VERIFIED, NOT_CONFIGURED, DEACTIVATED };
