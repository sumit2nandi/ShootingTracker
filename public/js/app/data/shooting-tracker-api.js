/**
 * The API as the UI sees it: named use cases, not URLs.
 *
 * Views depend on this vocabulary (`listShoots`, `markCollected`), so an
 * endpoint can be renamed or reshaped in one file, and a view can be tested
 * against a two-line stub.
 *
 * Data scoping rides here too: `setViewingAs()` tells the facade whose data
 * the owner is currently looking at, and every call that touches business data
 * — reads *and* writes (shoots, dashboard, calendar, meta, payments) — carries
 * it. The server attributes a write to the resolved scope, so an owner's edits
 * while viewing a member land on that member's account; for everyone else the
 * choice is empty and writes stay on their own data.
 */
export class ShootingTrackerApi {
  /** @param {{ client: import('./api-client.js').ApiClient }} deps */
  constructor({ client }) {
    this.client = client;
    this.viewingAs = null;
  }

  /**
   * Remember whose data an owner is viewing (null = their own). The server
   * re-validates the choice on every request; this only mirrors it.
   *
   * @param {string|null} email
   */
  setViewingAs(email) {
    this.viewingAs = email ? String(email).trim().toLowerCase() : null;
  }

  /**
   * Append the `viewingAs` parameter to a query string, when a choice is set.
   * Returns `undefined` (not an empty string) when nothing is added, so callers
   * can hand the result straight to the client as its `query` argument.
   */
  withViewing(query) {
    if (!this.viewingAs) return query || undefined;
    const suffix = `viewingAs=${encodeURIComponent(this.viewingAs)}`;
    return query ? `${query}&${suffix}` : suffix;
  }

  /* ---- session ---- */
  currentUser() {
    return this.client.get('/api/auth/me').then((data) => data.user);
  }

  signOut() {
    return this.client.post('/api/auth/logout');
  }

  /** Tell the server the first-login tour was seen. */
  markTourCompleted() {
    return this.client.post('/api/auth/me/tour-completed');
  }

  /* ---- reference data ---- */
  health() {
    return this.client.get('/api/health');
  }

  meta() {
    return this.client.get('/api/meta', this.withViewing(''));
  }

  dashboard(query) {
    return this.client.get('/api/dashboard', this.withViewing(query));
  }

  /* ---- shoots ---- */
  listShoots(query) {
    return this.client.get('/api/shoots', this.withViewing(query));
  }

  listShootsBetween(from, to) {
    return this.client.get('/api/shoots', this.withViewing(`from=${from}&to=${to}`));
  }

  getShoot(id) {
    // A read like the rest — so an owner viewing another account can open
    // their shoots' details (and, with the write calls below, edit them).
    return this.client.get(`/api/shoots/${id}`, this.withViewing(''));
  }

  createShoot(shoot) {
    // the query (not the body) carries the scope, so an owner adding a shoot
    // while viewing a member files it under that member's account
    return this.client.post('/api/shoots', shoot, this.withViewing(''));
  }

  updateShoot(id, patch) {
    return this.client.put(`/api/shoots/${id}`, patch, this.withViewing(''));
  }

  deleteShoot(id) {
    return this.client.delete(`/api/shoots/${id}`, this.withViewing(''));
  }

  /* ---- ledger ---- */
  addPayment(shootId, payment) {
    return this.client.post(`/api/shoots/${shootId}/payments`, payment, this.withViewing(''));
  }

  deletePayment(paymentId) {
    return this.client.delete(`/api/payments/${paymentId}`, this.withViewing(''));
  }

  /**
   * Undo the most recent collection on a shoot — the counterpart of the
   * one-tap "mark paid".
   *
   * @returns {Promise<object|null>} the payment that was removed, if any
   */
  async undoLastPayment(shootId) {
    const shoot = await this.getShoot(shootId);
    const [latest] = shoot.payments || [];   // the API lists the newest first
    if (!latest) return null;
    await this.deletePayment(latest.id);
    return latest;
  }

  /* ---- access ---- */
  listUsers() {
    return this.client.get('/api/users').then((data) => data.users || []);
  }

  addUser(user) {
    return this.client.post('/api/users', user);
  }

  updateUser(id, patch) {
    return this.client.patch(`/api/users/${id}`, patch);
  }

  removeUser(id) {
    return this.client.delete(`/api/users/${id}`);
  }
}
