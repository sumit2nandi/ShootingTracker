'use strict';

const { ValidationError } = require('../core/errors');
const { AccessPolicy } = require('../domain/access-policy');
const { DataScope } = require('../domain/data-scope');

/**
 * Resolves "whose data does this request read?" once per request.
 *
 *  - a member always gets their own scope, whatever the request carries;
 *  - an owner gets their own scope unless they ask for another account via
 *    `viewingAs` (the profile-tab choice), in which case the target must be
 *    an account that exists in `app_users`.
 *
 * Deactivated accounts are still viewable by the owner — their historical
 * data is no less real — but nobody else can ever target it.
 */
class DataScopeService {
  /** @param {{ userDirectory: import('./user-directory').UserDirectory }} deps */
  constructor({ userDirectory }) {
    this.userDirectory = userDirectory;
  }

  /**
   * @param {{ id: number, email: string, role: string }} viewer the signed-in account
   * @param {unknown} requestedEmail `req.query.viewingAs`, untrusted
   * @returns {Promise<DataScope>}
   */
  async resolve(viewer, requestedEmail) {
    if (viewer.role !== AccessPolicy.OWNER) return DataScope.forSelf(viewer.id);

    const email =
      typeof requestedEmail === 'string' ? AccessPolicy.normalizeEmail(requestedEmail) : '';
    if (!email) return DataScope.forSelf(viewer.id);
    if (email === AccessPolicy.normalizeEmail(viewer.email)) return DataScope.forSelf(viewer.id);

    const account = await this.userDirectory.lookup(email);
    if (!account) {
      throw new ValidationError(`No account named ${email} in this app`);
    }
    return new DataScope({ selfId: viewer.id, targetId: account.id });
  }
}

module.exports = { DataScopeService };
