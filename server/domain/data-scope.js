'use strict';

/**
 * Whose data a single request reads — and, separately, who it writes as.
 *
 * Reads always target `targetId`. Writes follow the *viewing* choice when an
 * owner is looking at another account — the owner manages that account's
 * data (add, edit, delete, pay) — and otherwise they land on the account's
 * own data. A member's scope is always self/self, so a member can never
 * write to anyone else's data.
 *
 * Pure value object over app_users ids — no database, no HTTP — which keeps
 * the scoping rule unit-testable and the repositories free of request logic.
 */
class DataScope {
  /**
   * @param {{ selfId: number, targetId: number }} ids app_users ids
   *        `selfId` — the signed-in account;
   *        `targetId` — the account whose data this request addresses.
   */
  constructor({ selfId, targetId }) {
    this.selfId = selfId;
    this.targetId = targetId;
  }

  /** The scope every account starts with: its own data. */
  static forSelf(selfId) {
    return new DataScope({ selfId, targetId: selfId });
  }

  /** True when an owner is looking at someone else's data. */
  get isViewingOther() {
    return this.selfId !== this.targetId;
  }

  /**
   * The account a *write* in this request belongs to: the viewed account
   * while an owner is looking at it, otherwise the signed-in account.
   */
  get writeId() {
    return this.isViewingOther ? this.targetId : this.selfId;
  }

  /** The `owner` value ShootFilter understands. */
  get filterOwner() {
    return String(this.targetId);
  }
}

module.exports = { DataScope };
