import { $ } from '../core/dom.js';

/**
 * The first-login website tour.
 *
 * Shown once, the first time a freshly created account opens the app: a card
 * with a spotlight on the part of the screen being described. Steps only
 * reference elements that exist on every screen (top bar, filter bar, the
 * bottom navigation, the new-shoot button), so no view has to load first, and
 * a missing anchor degrades to a centred card instead of breaking the tour.
 *
 * Finishing or skipping both report completion — the app then tells the server
 * so the tour never plays again for that account.
 */

/**
 * @param {{ index: number, target: string|null, title: string, body: string }} step
 *        `target` is a selector for the highlighted element, or null to centre.
 */
const STEPS = [
  {
    index: 0,
    target: null,
    title: 'Welcome to ShootingTracker',
    body: 'Everything you book, shoot and get paid for — in one place. This takes about a minute.'
  },
  {
    index: 1,
    target: '#kpi-row',
    title: 'Dashboard',
    body: 'Your totals at a glance: shoots, fees, what you have collected and what is still outstanding. The cards below split it by month, status, coordinator and type.'
  },
  {
    index: 2,
    target: '#filterbar',
    title: 'Filters',
    body: 'Narrow anything by month, coordinator, client, status, payment state, type, fee range — or just type to search. Filters apply to the dashboard and the shoot list.'
  },
  {
    index: 3,
    target: '#tab-calendar',
    title: 'Calendar',
    body: 'A month grid with every shoot on its date. Tap a day to add a shoot on it; tap a shoot to open its details.'
  },
  {
    index: 4,
    target: '#tab-shoots',
    title: 'Shoots',
    body: 'The full list, grouped by month. Every row opens the details: payments, photos and notes. Export downloads the original calendar CSV.'
  },
  {
    index: 5,
    target: '#btn-new-shoot-fab',
    title: 'New Shoot',
    body: 'Add a shoot from anywhere with this button. The basics are three fields; “More Details” keeps the rest out of your way.'
  },
  {
    index: 6,
    target: '#tab-profile',
    title: 'Profile',
    body: 'Your account, sign out — and, for owners, the list of people with access to this workspace. That is everything. Happy shooting!'
  }
];

export class SiteTour {
  /**
   * @param {{ onComplete: () => void, onSkip: () => void }} deps
   */
  constructor({ onComplete, onSkip }) {
    this.onComplete = onComplete;
    this.onSkip = onSkip;
    this.index = 0;
    this.overlay = null;
  }

  get stepCount() {
    return STEPS.length;
  }

  start() {
    this.#build();
    this.#show(0);
  }

  #build() {
    const overlay = document.createElement('div');
    overlay.className = 'tour-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'ShootingTracker tour');
    overlay.innerHTML = `
      <div class="tour-highlight" hidden></div>
      <div class="tour-card">
        <div class="tour-step" aria-live="polite"></div>
        <h3 class="tour-title"></h3>
        <p class="tour-body"></p>
        <div class="tour-dots" role="tablist"></div>
        <div class="tour-actions">
          <button type="button" class="btn btn-ghost tour-back">Back</button>
          <span class="tour-spacer"></span>
          <button type="button" class="btn btn-ghost tour-skip">Skip tour</button>
          <button type="button" class="btn btn-primary tour-next">Next</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    this.overlay = overlay;

    overlay.querySelector('.tour-back').addEventListener('click', () => this.#move(-1));
    overlay.querySelector('.tour-next').addEventListener('click', () => this.#next());
    overlay.querySelector('.tour-skip').addEventListener('click', () => this.#finish(true));
    document.addEventListener('keydown', this.#onKey);
    window.addEventListener('resize', () => this.#layout());
  }

  #onKey = (event) => {
    if (event.key === 'Escape') this.#finish(true);
    else if (event.key === 'ArrowRight') this.#next();
    else if (event.key === 'ArrowLeft' && this.index > 0) this.#move(-1);
  };

  #show(index) {
    this.index = index;
    const step = STEPS[index];
    const card = this.overlay.querySelector('.tour-card');

    this.overlay.querySelector('.tour-step').textContent = `${index + 1} of ${STEPS.length}`;
    this.overlay.querySelector('.tour-title').textContent = step.title;
    this.overlay.querySelector('.tour-body').textContent = step.body;

    const dots = this.overlay.querySelector('.tour-dots');
    dots.innerHTML = STEPS.map((s, i) => `<i class="tour-dot${i === index ? ' active' : ''}"></i>`).join('');

    this.overlay.querySelector('.tour-back').hidden = index === 0;
    const next = this.overlay.querySelector('.tour-next');
    next.textContent = index === STEPS.length - 1 ? 'Finish' : 'Next';

    const target = step.target ? $(step.target) : null;
    const highlight = this.overlay.querySelector('.tour-highlight');
    if (target) {
      highlight.hidden = false;
      highlight.dataset.for = step.target;
    } else {
      highlight.hidden = true;
      delete highlight.dataset.for;
    }
    this.#layout();
  }

  /** Place the spotlight over the current target and the card beside it. */
  #layout() {
    if (!this.overlay) return;
    const step = STEPS[this.index];
    const highlight = this.overlay.querySelector('.tour-highlight');
    const card = this.overlay.querySelector('.tour-card');
    const target = step.target ? $(step.target) : null;

    if (target) {
      const rect = target.getBoundingClientRect();
      const pad = 6;
      Object.assign(highlight.style, {
        top: `${Math.max(0, rect.top - pad)}px`,
        left: `${Math.max(0, rect.left - pad)}px`,
        width: `${Math.max(24, rect.width + pad * 2)}px`,
        height: `${Math.max(24, rect.height + pad * 2)}px`
      });

      const cardW = Math.min(420, window.innerWidth - 32);
      const below = rect.bottom + 12;
      const cardH = card.offsetHeight || 220;
      const top = below + cardH + 16 > window.innerHeight ? Math.max(12, rect.top - cardH - 12) : below;
      const left = Math.min(
        Math.max(16, rect.left + rect.width / 2 - cardW / 2),
        window.innerWidth - cardW - 16
      );
      Object.assign(card.style, {
        width: `${cardW}px`,
        top: `${top}px`,
        left: `${left}px`,
        bottom: 'auto',
        right: 'auto'
      });
    } else {
      Object.assign(card.style, {
        width: 'min(420px, calc(100vw - 32px))',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        bottom: 'auto',
        right: 'auto'
      });
    }
  }

  #next() {
    if (this.index >= STEPS.length - 1) this.#finish(false);
    else this.#show(this.index + 1);
  }

  #move(delta) {
    const next = this.index + delta;
    if (next >= 0 && next < STEPS.length) this.#show(next);
  }

  #finish(skipped) {
    this.dispose();
    if (skipped) this.onSkip();
    else this.onComplete();
  }

  /** Tear the overlay down and its listeners with it. */
  dispose() {
    if (!this.overlay) return;
    this.overlay.remove();
    this.overlay = null;
    document.removeEventListener('keydown', this.#onKey);
    window.removeEventListener('resize', this.#layout);
  }
}
