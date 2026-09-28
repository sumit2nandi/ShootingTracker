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
 * Mobile: browsers on phones move their chrome (the URL bar, the home
 * indicator) under the page, so every measurement goes through
 * `window.visualViewport` — the part of the screen that is actually visible —
 * and the layout re-runs on visual-viewport scroll/resize as well as on page
 * scroll. On narrow screens the card becomes a full-width sheet pinned to the
 * free side of the highlighted element, with 44px-tall buttons.
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
    body: 'Your account and sign out live here — owners also manage the people with access from here. That is everything. Happy shooting!'
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
    document.body.classList.add('tour-open'); // the page does not scroll under the tour
    this.#show(0);
  }

  #build() {
    const overlay = document.createElement('div');
    overlay.className = 'tour-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'ShootingTracker tour');
    overlay.innerHTML = `
      <div class="tour-highlight"></div>
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
    window.addEventListener('resize', this.#onReflow);
    window.addEventListener('scroll', this.#onReflow, { passive: true });
    // on phones the visible area moves with the browser chrome — follow it
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', this.#onReflow);
      window.visualViewport.addEventListener('scroll', this.#onReflow);
    }
  }

  /** The visible part of the screen, in layout-viewport coordinates. */
  #metrics() {
    const vv = window.visualViewport;
    return vv
      ? { width: vv.width, height: vv.height, top: vv.offsetTop, left: vv.offsetLeft }
      : { width: window.innerWidth, height: window.innerHeight, top: 0, left: 0 };
  }

  #onKey = (event) => {
    if (event.key === 'Escape') this.#finish(true);
    else if (event.key === 'ArrowRight') this.#next();
    else if (event.key === 'ArrowLeft' && this.index > 0) this.#move(-1);
  };

  #onReflow = () => this.#layout();

  #show(index) {
    this.index = index;
    const step = STEPS[index];

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
      highlight.dataset.for = step.target;
    } else {
      delete highlight.dataset.for;
    }
    this.#layout();
  }

  /**
   * Place the spotlight over the current target and the card where there is
   * room. Everything is measured against the visual viewport, so the card and
   * the cut-out stay where the user can see them while a phone's browser
   * chrome slides. The page never scrolls for the tour (the body is locked),
   * so a target pushed out of the visible area simply gets its cut-out
   * clamped to the nearest edge.
   */
  #layout() {
    if (!this.overlay) return;
    const step = STEPS[this.index];
    const highlight = this.overlay.querySelector('.tour-highlight');
    const card = this.overlay.querySelector('.tour-card');
    const { width, height, top, left } = this.#metrics();
    const margin = 12;
    const target = step.target ? $(step.target) : null;

    if (!target) {
      // no element to spotlight: full scrim, card in the middle of the screen
      highlight.classList.add('full');
      Object.assign(highlight.style, { top: '0', left: '0', right: '0', bottom: '0', width: 'auto', height: 'auto' });
      this.#centerCard(card, { width, height, top, left, margin });
      return;
    }
    highlight.classList.remove('full');

    const rect = target.getBoundingClientRect();
    const right = left + width;
    const bottom = top + height;
    const pad = 6;
    const inArea = rect.bottom > top + 8 && rect.top < bottom - 8 && rect.right > left + 8 && rect.left < right - 8;

    if (!inArea) {
      // the target sits behind the phone's browser chrome (or is otherwise
      // off-screen): mark the nearest edge with a sliver and keep the card in
      // the open middle of the visible area
      const x1 = Math.min(Math.max(rect.left, left + 24), right - 24);
      const x2 = Math.min(Math.max(rect.left + rect.width, left + 24), right - 24);
      Object.assign(highlight.style, {
        top: rect.bottom <= top ? `${top}px` : `${bottom - 24}px`,
        left: `${x1}px`,
        right: 'auto',
        bottom: 'auto',
        width: `${Math.max(24, x2 - x1)}px`,
        height: '24px'
      });
      this.#centerCard(card, { width, height, top, left, margin });
      return;
    }

    const x1 = Math.max(rect.left - pad, left);
    const y1 = Math.max(rect.top - pad, top);
    const x2 = Math.min(rect.left + rect.width + pad, right);
    const y2 = Math.min(rect.top + rect.height + pad, bottom);
    Object.assign(highlight.style, {
      top: `${y1}px`,
      left: `${x1}px`,
      right: 'auto',
      bottom: 'auto',
      width: `${Math.max(24, x2 - x1)}px`,
      height: `${Math.max(24, y2 - y1)}px`
    });

    const compact = width <= 640; // phone-sized: the card becomes a full-width sheet
    const cardW = compact ? width - margin * 2 : Math.min(420, width - 32);
    card.style.width = `${cardW}px`;
    const cardH = card.offsetHeight || 220;
    const gap = 12;

    // the sheet sits on the side of the target with the more free space, so
    // the spotlight is never buried under the card
    const rectBottom = Math.min(rect.bottom, bottom);
    const rectTop = Math.max(rect.top, top);
    const freeBelow = bottom - rectBottom;
    const freeAbove = rectTop - top;
    const ideal = freeBelow >= freeAbove ? rectBottom + gap : rectTop - cardH - gap;
    const clampedTop = Math.max(top + margin, Math.min(ideal, bottom - cardH - margin));

    Object.assign(card.style, {
      width: `${cardW}px`,
      top: `${clampedTop}px`,
      left: compact
        ? `${left + margin}px`
        : `${Math.min(Math.max(16, rect.left + rect.width / 2 - cardW / 2), right - cardW - 16)}px`,
      transform: 'none',
      bottom: 'auto',
      right: 'auto'
    });
  }

  /** A centred card (the welcome step): width capped, never past the edges. */
  #centerCard(card, { width, height, top, left, margin }) {
    const cardW = Math.min(420, width - margin * 2);
    card.style.width = `${cardW}px`;
    const cardH = card.offsetHeight || 220;
    Object.assign(card.style, {
      width: `${cardW}px`,
      top: `${Math.max(top + margin, top + (height - cardH) / 2)}px`,
      left: `${left + Math.max(margin, (width - cardW) / 2)}px`,
      transform: 'none',
      bottom: 'auto',
      right: 'auto'
    });
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
    document.body.classList.remove('tour-open');
    document.removeEventListener('keydown', this.#onKey);
    window.removeEventListener('resize', this.#onReflow);
    window.removeEventListener('scroll', this.#onReflow);
    if (window.visualViewport) {
      window.visualViewport.removeEventListener('resize', this.#onReflow);
      window.visualViewport.removeEventListener('scroll', this.#onReflow);
    }
  }
}
