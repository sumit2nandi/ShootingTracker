'use strict';

/**
 * Whose data a single request reads — and, separately, who it would write as.
 *
 * The two are deliberately different: every account's *writes* always land in
 * its own data, while an *owner's reads* may be pointed at any account's data
 * (the "viewing" choice made in the profile tab). Members always read their
 * own data, whatever they ask for.
 *
 * Pure value object over app_users ids — no database, no HTTP — which keeps
 * the scoping rule unit-testable and the repositories free of request logic.
 */
class DataScope {
  /**
   * @param {{ selfId: number, targetId: number }} ids app_users ids
   *        `selfId` — the signed-in account (writes go here);
   *        `targetId` — the account whose data reads target.
   */
  constructor({ selfId, targetId }) {
    this.selfId = selfId;
    this.targetId = targetId;
  }

  /** The scope every account starts with: its own data. */
  static forSelf(selfId) {
    return new DataScope({ selfId, targetId: selfId });
  }

  /** True when an owner is looking at someone else's data (read-only mode). */
  get isViewingOther() {
    return this.selfId !== this.targetId;
  }

  /** The `owner` value ShootFilter understands. */
  get filterOwner() {
    return String(this.targetId);
  }
}

module.exports = { DataScope };
