/**
 * The API as the UI sees it: named use cases, not URLs.
 *
 * Views depend on this vocabulary (`listShoots`, `markCollected`), so an
 * endpoint can be renamed or reshaped in one file, and a view can be tested
 * against a two-line stub.
 */
export class ShootingTrackerApi {
  /** @param {{ client: import('./api-client.js').ApiClient }} deps */
  constructor({ client }) {
    this.client = client;
  }

  /* ---- session ---- */
  currentUser() {
    return this.client.get('/api/auth/me').then((data) => data.user);
  }

  signOut() {
    return this.client.post('/api/auth/logout');
  }

  /* ---- reference data ---- */
  health() {
    return this.client.get('/api/health');
  }

  meta() {
    return this.client.get('/api/meta');
  }

  dashboard(query) {
    return this.client.get('/api/dashboard', query);
  }

  /* ---- shoots ---- */
  listShoots(query) {
    return this.client.get('/api/shoots', query);
  }

  listShootsBetween(from, to) {
    return this.client.get('/api/shoots', `from=${from}&to=${to}`);
  }

  getShoot(id) {
    return this.client.get(`/api/shoots/${id}`);
  }

  createShoot(shoot) {
    return this.client.post('/api/shoots', shoot);
  }

  updateShoot(id, patch) {
    return this.client.put(`/api/shoots/${id}`, patch);
  }

  deleteShoot(id) {
    return this.client.delete(`/api/shoots/${id}`);
  }

  /* ---- ledger ---- */
  addPayment(shootId, payment) {
    return this.client.post(`/api/shoots/${shootId}/payments`, payment);
  }

  deletePayment(paymentId) {
    return this.client.delete(`/api/payments/${paymentId}`);
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
