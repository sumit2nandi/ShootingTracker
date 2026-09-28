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

/** The destinations the filter bar applies to; the others hide it. */
const FILTERED_VIEWS = new Set(['dashboard', 'shoots']);

class Application {
  constructor() {
    this.store = new Store({
      view: 'dashboard',
      user: null,
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
      newShoot: (dateKey) => this.shootForm.open(null, dateKey),
      editShoot: (shoot) => this.shootForm.open(shoot),
      openAccess: () => this.access.open(),
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
      profile: async () => this.profile.render(this.store.get().user)
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
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      this.shootForm.close();
      this.drawer.close();
      this.access.close();
    });
  }

  async start() {
    this.mount();
    // whatever happens next, the splash never traps the app on screen
    setTimeout(() => this.#hideLoader(), 8000);

    let user;
    try {
      user = await this.api.currentUser();
    } catch {
      this.#hideLoader();
      return; // the API client already redirected to the sign-in page
    }
    this.store.update({ user });
    this.profile.render(user);

    this.dbStatus.start();
    await this.loadMeta();
    await this.setView('dashboard');
    this.#hideLoader();
  }

  /** Fade the boot splash out, then take it out of the document entirely. */
  #hideLoader() {
    const loader = $('#app-loader');
    if (!loader || document.body.classList.contains('app-ready')) return;
    document.body.classList.add('app-ready');
    setTimeout(() => loader.remove(), 500);
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
