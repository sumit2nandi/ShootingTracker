/**
 * Browser composition root.
 *
 * Builds every collaborator once, hands each view the few things it needs, and
 * owns the only pieces of cross-view logic: which tab is showing, which filters
 * belong to it, and what "refresh" means. Views never import each other — they
 * report to the `actions` mediator defined here.
 */

import { $, $$ } from './core/dom.js';
import { Store } from './core/store.js';
import { ThemeController } from './core/theme.js';
import { ApiClient } from './data/api-client.js';
import { ShootingTrackerApi } from './data/shooting-tracker-api.js';
import { FilterCriteria } from './domain/filter-criteria.js';
import { buildExportCsv, downloadText } from './domain/csv-export.js';
import { Toaster } from './ui/toaster.js';
import { DatabaseStatus } from './ui/database-status.js';
import { FilterBar } from './ui/filter-bar.js';
import { DashboardView } from './ui/dashboard-view.js';
import { CalendarView } from './ui/calendar-view.js';
import { ShootsView } from './ui/shoots-view.js';
import { ShootDrawer } from './ui/shoot-drawer.js';
import { ShootForm } from './ui/shoot-form.js';
import { AccessView } from './ui/access-view.js';
import { ProfileView } from './ui/profile-view.js';
import { SiteTour } from './ui/tour.js';

/** The destinations the filter bar applies to; the others hide it. */
const FILTERED_VIEWS = new Set(['dashboard', 'shoots']);

/** The owner's "viewing" choice survives reloads, per browser. */
const VIEWING_STORAGE_KEY = 'shootingtracker-viewing-as';

class Application {
  constructor() {
    this.store = new Store({
      view: 'dashboard',
      user: null,
      users: [], // the allow-list; loaded for owners (viewing selector)
      viewingAs: null, // whose data an owner is currently viewing (email or null)
      meta: { statuses: [], coordinators: [], clients: [], types: [], months: [] },
      filters: FilterCriteria.empty(),
      shootsFiltersOpen: false,
      dbOk: null
    });

    this.toaster = new Toaster();
    this.theme = new ThemeController();
    this.api = new ShootingTrackerApi({
      client: new ApiClient({ onUnauthorized: () => window.location.replace('/') })
    });

    // The mediator: what a view can ask the application to do.
    const actions = {
      openShoot: (id) => this.drawer.showShoot(id),
      openDay: (dateKey, shoots) => this.drawer.showDay(dateKey, shoots),
      // while an owner views a member's data these writes are filed under
      // that member's account (the server resolves it); for everyone else
      // they land on their own data as always
      newShoot: (dateKey) => this.shootForm.open(null, dateKey),
      editShoot: (shoot) => this.shootForm.open(shoot),
      // the entry point does not exist in a member's app, and the modal's own
      // open() re-checks the role — belt and braces
      openAccess: () => this.access.open(),
      setViewingAs: (email) => this.#applyViewing(email),
      dataChanged: (options) => this.dataChanged(options),
      showShootsFiltered: (extra) => this.showShootsFiltered(extra),
      resetFilters: () => this.resetShootsFilters(),
      toggleFilters: () => this.toggleShootsFilters(),
      clearFilters: () => this.filterBar.clear(),
      notify: (message) => this.toaster.success(message),
      notifyError: (message) => this.toaster.error(message)
    };
    this.actions = actions;

    this.filterBar = new FilterBar({ onChange: () => this.refresh() });
    this.dashboard = new DashboardView({ api: this.api, actions });
    this.calendar = new CalendarView({ api: this.api, actions });
    this.shoots = new ShootsView({ api: this.api, actions });
    this.drawer = new ShootDrawer({ api: this.api, actions });
    this.shootForm = new ShootForm({ api: this.api, actions });
    this.access = new AccessView({ api: this.api, store: this.store, actions });
    this.profile = new ProfileView({ api: this.api, actions });
    this.dbStatus = new DatabaseStatus({ api: this.api, store: this.store });

    /** view id → the object that knows how to load it */
    this.loaders = {
      dashboard: () => this.dashboard.load(this.store.get().filters),
      shoots: () => this.shoots.load(this.store.get().filters),
      calendar: () => this.calendar.load(),
      profile: async () => {
        const { user, users, viewingAs } = this.store.get();
        this.profile.render(user, users, viewingAs);
      }
    };
  }

  /* ---------------- wiring ---------------- */

  mount() {
    this.theme.start();
    this.theme.onChange((theme) => this.#applyThemeChrome(theme));
    this.#applyThemeChrome(this.theme.current);
    $('#btn-theme').addEventListener('click', () => this.theme.toggle());

    [this.filterBar, this.dashboard, this.calendar, this.shoots, this.drawer, this.shootForm, this.access, this.profile].forEach(
      (component) => component.mount()
    );

    $$('.tab[data-view]').forEach((tab) => tab.addEventListener('click', () => this.setView(tab.dataset.view)));
    $('#btn-export').addEventListener('click', () => this.exportCsv());
    $('#viewing-banner-back')?.addEventListener('click', () => this.#applyViewing(null));
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      this.shootForm.close();
      this.drawer.close();
      this.access.close();
    });
  }

  async start() {
    this.mount();
    // the splash is capped: 1.2s on screen + a 0.3s fade = 1.5s, whatever the
    // network is doing. It still leaves earlier, the moment the data is in.
    setTimeout(() => this.#hideLoader(), 1200);

    let user;
    try {
      user = await this.api.currentUser();
    } catch {
      this.#hideLoader();
      return; // the API client already redirected to the sign-in page
    }
    this.store.update({ user });
    await this.#setupViewing(user);
    this.profile.render(user, this.store.get().users, this.store.get().viewingAs);

    this.dbStatus.start();
    await this.loadMeta();
    await this.setView('dashboard');
    this.#hideLoader();

    // a brand-new account (created moments ago via the consent form) gets the
    // website tour on this, their very first login
    this.#maybeStartTour(user);
  }

  /* ---------------- owner "viewing" mode ---------------- */

  /**
   * Owners can look at any account's data, chosen in the profile tab;
   * members always see their own. The choice is restored from storage, but
   * only while the account still exists — the server would reject it anyway.
   */
  async #setupViewing(user) {
    if (!user || user.role !== 'owner') {
      this.api.setViewingAs(null);
      this.#syncViewingChrome();
      return;
    }
    let users = [];
    try {
      users = await this.api.listUsers();
    } catch {
      users = []; // the status pill reports the outage
    }
    this.store.update({ users });

    const saved = this.#readSavedViewing();
    const stillKnown = saved && users.some((entry) => entry.email.toLowerCase() === String(saved).toLowerCase());
    this.#applyViewing(stillKnown ? saved : null);
  }

  #readSavedViewing() {
    try {
      return localStorage.getItem(VIEWING_STORAGE_KEY) || null;
    } catch {
      return null; // storage blocked (private mode) — start with one's own data
    }
  }

  /**
   * Switch whose data the owner is viewing (null = their own), remember it,
   * and reload the reference data and whatever is on screen.
   */
  async #applyViewing(email) {
    const { user, users } = this.store.get();
    const match = email && users.find((entry) => entry.email.toLowerCase() === String(email).toLowerCase());
    // Choosing one's own account is the same as choosing nobody: own data is
    // the default, and the "Back to my data" banner never belongs to it.
    const isSelf = match && String(match.email).toLowerCase() === String((user && user.email) || '').toLowerCase();
    const viewingAs = match && !isSelf ? match.email : null;

    this.store.update({ viewingAs });
    this.api.setViewingAs(viewingAs);
    try {
      if (viewingAs) localStorage.setItem(VIEWING_STORAGE_KEY, viewingAs);
      else localStorage.removeItem(VIEWING_STORAGE_KEY);
    } catch {
      /* the choice simply will not survive a reload */
    }
    this.#syncViewingChrome();
    this.profile.render(user, users, viewingAs);
    await this.loadMeta();
    await this.refresh(false);
  }

  /**
   * The "whose data is on screen" banner. It is visible exactly while an
   * owner looks at another account — never for members, never for one's own
   * data — and it always names the account currently on screen.
   */
  #syncViewingChrome() {
    const { user, users, viewingAs } = this.store.get();
    const other = Boolean(
      user && user.role === 'owner' && viewingAs && viewingAs.toLowerCase() !== String(user.email).toLowerCase()
    );

    const banner = $('#viewing-banner');
    if (!banner) return;
    if (!other) {
      banner.hidden = true;
      return;
    }
    const target = (users || []).find((entry) => entry.email.toLowerCase() === String(viewingAs).toLowerCase());
    const name = (target && (target.name || target.email)) || viewingAs;
    $('#viewing-banner-text').textContent = `Viewing ${name}'s data — new shoots and edits are saved to ${name}'s account.`;
    banner.hidden = false;
  }

  /* ---------------- first-login tour ---------------- */

  #maybeStartTour(user) {
    if (!user || user.tour_completed) return;
    this.tour = new SiteTour({
      onComplete: () => this.#finishTour('You are all set — happy shooting!'),
      onSkip: () => this.#finishTour()
    });
    this.tour.start();
  }

  /** Remember the tour was seen, locally and on the server. */
  async #finishTour(message) {
    const user = this.store.get().user;
    if (user) this.store.update({ user: { ...user, tour_completed: true } });
    try {
      await this.api.markTourCompleted();
    } catch {
      /* the flag will simply be saved on the next visit */
    }
    if (message) this.toaster.success(message);
  }

  /** Fade the boot splash out, then take it out of the document entirely. */
  #hideLoader() {
    const loader = $('#app-loader');
    if (!loader || document.body.classList.contains('app-ready')) return;
    document.body.classList.add('app-ready');
    setTimeout(() => loader.remove(), 320); // once the fade is done
  }

  /* ---------------- shared data ---------------- */

  async loadMeta() {
    let meta;
    try {
      meta = await this.api.meta();
    } catch {
      return; // the status pill already reports the outage
    }
    this.store.update({ meta });
    this.filterBar.populate(meta);
    this.shootForm.populate(meta);
    this.calendar.populate(meta);
  }

  /** Something was created, edited or deleted: reload reference data and the view. */
  async dataChanged({ reloadMeta = true } = {}) {
    if (reloadMeta) await this.loadMeta();
    return this.refresh(false);
  }

  /* ---------------- routing ---------------- */

  /**
   * Show a destination. Every visit starts from scratch — no filters, no
   * expanded groups and no leftover month from last time — unless the caller
   * passes criteria on purpose (a dashboard tile drilling into Shoots).
   *
   * @param {string} view
   * @param {{ filters?: import('./domain/filter-criteria.js').FilterCriteria }} [options]
   */
  setView(view, { filters = null } = {}) {
    this.store.update({ view, shootsFiltersOpen: Boolean(filters) });
    $$('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.view === view));
    $$('.view').forEach((section) => section.classList.toggle('hidden', section.id !== `view-${view}`));

    // every month group open only when a tile asked for a specific slice
    this.shoots.setExpandAll(Boolean(filters));
    if (view === 'calendar') this.calendar.resetToToday();

    window.scrollTo(0, 0); // a fresh tab starts at the top, not where the last one was
    this.filterBar.write(filters || FilterCriteria.empty());
    this.filterBar.setContext(view);
    this.#syncFilterVisibility(view);
    this.store.update({ filters: this.filterBar.read() });

    return this.refresh(false);
  }

  /** The filter bar belongs to the dashboard, and to Shoots when asked for. */
  #syncFilterVisibility(view = this.store.get().view) {
    const open = this.store.get().shootsFiltersOpen;
    const shown = view === 'dashboard' || (view === 'shoots' && open);
    this.filterBar.setVisible(FILTERED_VIEWS.has(view) && shown);
    const toggle = $('#btn-shoots-filter');
    if (toggle) {
      toggle.setAttribute('aria-expanded', String(open));
      toggle.classList.toggle('active', open);
    }
  }

  /** @param {boolean} reRead read the controls again (false when we just wrote them) */
  refresh(reRead = true) {
    if (reRead) this.store.update({ filters: this.filterBar.read() });
    const load = this.loaders[this.store.get().view];
    if (!load) return Promise.resolve();
    return load().catch((error) => this.toaster.error(`${this.store.get().view}: ${error.message}`));
  }

  /* ---------------- shoots tab helpers ---------------- */

  /** A dashboard tile was clicked: open the Shoots tab already filtered. */
  showShootsFiltered(extra) {
    const current = this.store.get().filters;
    this.setView('shoots', {
      filters: new FilterCriteria({ month: current.month, coordinator: current.coordinator, ...extra })
    });
  }

  toggleShootsFilters() {
    this.store.update({ shootsFiltersOpen: !this.store.get().shootsFiltersOpen });
    this.#syncFilterVisibility();
    this.store.update({ filters: this.filterBar.read() });
  }

  resetShootsFilters() {
    const empty = FilterCriteria.empty();
    this.filterBar.write(empty);
    this.store.update({ filters: empty });
    this.shoots.syncResetButton(empty);
    this.refresh(false);
    this.toaster.success('Showing all shoots');
  }

  /* ---------------- export ---------------- */

  async exportCsv() {
    try {
      const rows = await this.api.listShoots('');
      if (!rows.length) {
        this.toaster.error('Nothing to export yet — add some shoots first');
        return;
      }
      const earliestYear = rows.reduce(
        (earliest, shoot) => (String(shoot.shoot_date).slice(0, 4) < earliest ? String(shoot.shoot_date).slice(0, 4) : earliest),
        '9999'
      );
      downloadText(`Shooting-Calendar-${earliestYear}.csv`, buildExportCsv(rows));
      this.toaster.success(`Exported ${rows.length} shoots`);
    } catch (error) {
      this.toaster.error('Export failed: ' + error.message);
    }
  }

  #applyThemeChrome(theme) {
    const dark = theme === 'dark';
    const meta = $('#meta-theme-color');
    if (meta) meta.setAttribute('content', dark ? '#000000' : '#f4f3f9');
    const button = $('#btn-theme');
    if (button) {
      const label = dark ? 'Switch to light mode' : 'Switch to dark mode';
      button.title = label;
      button.setAttribute('aria-label', label);
    }
  }
}

new Application().start();

export { Application };
