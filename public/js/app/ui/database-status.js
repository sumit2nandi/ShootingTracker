import { $, escapeHtml } from '../core/dom.js';

/** The connectivity pill in the top bar, plus the explanatory banner. */
export class DatabaseStatus {
  constructor({ api, store, pollMs = 30_000 }) {
    this.api = api;
    this.store = store;
    this.pollMs = pollMs;
    this.pill = $('#db-status');
  }

  async poll() {
    try {
      const health = await this.api.health();
      this.store.update({ dbOk: health.ok });
      this.#renderPill(health.ok, health.ok ? `Connected (${health.latencyMs} ms)` : `DB unreachable: ${health.detail}`);
      if (!health.ok) this.#showBanner(health.detail);
      else this.#hideBanner();
    } catch {
      this.store.update({ dbOk: false });
      this.#renderPill(false, 'offline', 'Offline');
    }
  }

  start() {
    this.poll();
    setInterval(() => this.poll(), this.pollMs);
  }

  #renderPill(ok, title, label) {
    if (!this.pill) return;
    this.pill.className = `db-pill ${ok ? 'ok' : 'bad'}`;
    this.pill.title = title;
    const text = this.pill.querySelector('.db-pill-text');
    if (text) text.textContent = label || (ok ? 'DB Connected' : 'DB Unreachable');
  }

  #showBanner(detail) {
    if ($('#db-banner')) return;
    $('#main').insertAdjacentHTML(
      'afterbegin',
      `<div id="db-banner" class="card" style="border-color:rgba(239,93,111,.5)">
        <b>⚠️ Database unreachable.</b> <span class="muted">${escapeHtml(detail)}</span><br/>
        <span class="muted small">Check <code>.env → DATABASE_URL</code> (Aiven: add this host's IP to the allowlist, and apply
        <code>server/schema.sql</code> if you haven't). Retrying automatically…</span>
      </div>`
    );
  }

  #hideBanner() {
    const banner = $('#db-banner');
    if (banner) banner.remove();
  }
}
