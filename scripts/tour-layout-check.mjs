// Headless check of the tour layout math.
//
// Usage: node scripts/tour-layout-check.mjs
//
// Stubs the minimum DOM the tour touches (document/window/visualViewport/
// elements), drives all seven steps through the real click handlers, and
// asserts that — across phone and desktop viewports, URL-bar expanded or
// collapsed — the card and the spotlight stay inside the visible area and
// the card never covers the spotlight by more than the unavoidable amount.
import { readFileSync } from 'fs';

// target rects on a 390x741 phone layout viewport (as the real app lays them out)
const PHONE_RECTS = {
  '#kpi-row': { left: 16, top: 120, width: 358, height: 90 },
  '#filterbar': { left: 16, top: 232, width: 358, height: 54 },
  '#tab-calendar': { left: 148, top: 688, width: 62, height: 48 },
  '#tab-shoots': { left: 212, top: 688, width: 62, height: 48 },
  '#btn-new-shoot-fab': { left: 318, top: 661, width: 56, height: 56 },
  '#tab-profile': { left: 330, top: 688, width: 44, height: 48 }
};
const DESKTOP_RECTS = {};
for (const [k, r] of Object.entries(PHONE_RECTS)) {
  DESKTOP_RECTS[k] = { left: r.left * 2.6, top: r.top * 1.05, width: r.width * 2.4, height: r.height + 8 };
}

function makeEl(name, rect) {
  const el = {
    name,
    style: {},
    dataset: {},
    hidden: false,
    offsetHeight: 230,
    handlers: {},
    setAttribute() {},
    addEventListener(ev, fn) { el.handlers[ev] = fn; },
    removeEventListener() {},
    click() { el.handlers.click && el.handlers.click(); },
    classList: {
      _s: new Set(),
      add(cl) { this._s.add(cl); },
      remove(cl) { this._s.delete(cl); },
      contains(cl) { return this._s.has(cl); }
    },
    getBoundingClientRect: () => ({ ...rect, bottom: rect.top + rect.height, right: rect.left + rect.width }),
    remove() { el.gone = true; }
  };
  return el;
}

function makeDom(viewport) {
  const rects = viewport.phone ? PHONE_RECTS : DESKTOP_RECTS;
  const targets = {};
  for (const [sel, rect] of Object.entries(rects)) targets[sel] = makeEl(sel, rect);

  const highlight = makeEl('.tour-highlight', { left: 0, top: 0, width: 0, height: 0 });
  const card = makeEl('.tour-card', { left: 0, top: 0, width: 400, height: 230 });
  const bits = {};
  for (const cls of ['tour-step', 'tour-title', 'tour-body', 'tour-dots', 'tour-back', 'tour-next', 'tour-skip']) {
    bits[cls] = makeEl('.' + cls, { left: 0, top: 0, width: 10, height: 10 });
  }
  const overlay = makeEl('.tour-overlay', { left: 0, top: 0, width: 10, height: 10 });
  overlay.querySelector = (q) => {
    if (q === '.tour-highlight') return highlight;
    if (q === '.tour-card') return card;
    return bits[q.replace('.', '')] || null;
  };

  const body = {
    classList: { _s: new Set(), add(cl) { this._s.add(cl); }, remove(cl) { this._s.delete(cl); }, contains(cl) { return this._s.has(cl); } },
    appendChild(el) { body.lastChild = el; }
  };
  const docListeners = {};
  const doc = {
    body,
    createElement: () => overlay,
    addEventListener(ev, fn) { docListeners[ev] = fn; },
    removeEventListener(ev) { delete docListeners[ev]; },
    querySelector: (sel) => targets[sel] || null
  };
  const vvListeners = {};
  const visualViewport = viewport.visualViewport
    ? { ...viewport.visualViewport, addEventListener(ev, fn) { vvListeners[ev] = fn; }, removeEventListener(ev) { delete vvListeners[ev]; } }
    : null;
  const winListeners = {};
  const win = {
    visualViewport,
    innerWidth: viewport.layoutWidth,
    innerHeight: viewport.layoutHeight,
    addEventListener(ev, fn) { winListeners[ev] = fn; },
    removeEventListener(ev) { delete winListeners[ev]; }
  };
  return { doc, win, body, targets, overlay, highlight, card, bits, vvListeners, winListeners, docListeners };
}

function loadTourClass(dom) {
  const src = readFileSync(new URL('../public/js/app/ui/tour.js', import.meta.url), 'utf8');
  const wrapped = src.replace(/^import .*$/m, '').replace('export class SiteTour', 'class SiteTour');
  const $ = (sel) => dom.doc.querySelector(sel);
  return new Function('$', 'document', 'window', `${wrapped}\nreturn SiteTour;`)($, dom.doc, dom.win);
}

function px(v) { return typeof v === 'string' ? parseFloat(v) : (v === undefined ? NaN : v); }
// the card's height is measured via offsetHeight (never written to style),
// the highlight's height is written to style.height — use whichever exists
function boxOf(el) { return { top: px(el.style.top), left: px(el.style.left), width: px(el.style.width), height: el.style.height !== undefined ? px(el.style.height) : el.offsetHeight }; }
function overlap(a, b, pad = 3) {
  return a.left < b.left + b.width - pad && a.left + a.width > b.left + pad && a.top < b.top + b.height - pad && a.top + a.height > b.top + pad;
}

let failures = 0;
const ok = (label, cond, detail) => {
  if (cond) console.log(`  ok ${label}`);
  else { failures++; console.error(`  FAIL ${label}${detail ? ' — ' + detail : ''}`); }
};

const CASES = [
  { label: 'phone, URL bar expanded (visual 390x548)', phone: true, layoutWidth: 390, layoutHeight: 741, visualViewport: { width: 390, height: 548, offsetTop: 0, offsetLeft: 0 } },
  { label: 'phone, URL bar collapsed (visual 390x741)', phone: true, layoutWidth: 390, layoutHeight: 741, visualViewport: { width: 390, height: 741, offsetTop: 0, offsetLeft: 0 } },
  { label: 'small phone 320x568, bar expanded (visual 320x412)', phone: true, layoutWidth: 320, layoutHeight: 568, visualViewport: { width: 320, height: 412, offsetTop: 0, offsetLeft: 0 } },
  { label: 'phone scrolled: visual viewport offset 90px down', phone: true, layoutWidth: 390, layoutHeight: 741, visualViewport: { width: 390, height: 651, offsetTop: 90, offsetLeft: 0 } },
  { label: 'desktop 1280x800, no visualViewport', phone: false, layoutWidth: 1280, layoutHeight: 800, visualViewport: null }
];

const TARGETS = [null, '#kpi-row', '#filterbar', '#tab-calendar', '#tab-shoots', '#btn-new-shoot-fab', '#tab-profile'];

for (const c of CASES) {
  console.log(`\n-- ${c.label} --`);
  const dom = makeDom(c);
  const SiteTour = loadTourClass(dom);
  let completed = false;
  const tour = new SiteTour({ onComplete() { completed = true; }, onSkip() {} });
  tour.start();

  const vv = dom.win.visualViewport || { width: dom.win.innerWidth, height: dom.win.innerHeight, offsetTop: 0, offsetLeft: 0 };
  const area = { top: vv.offsetTop, left: vv.offsetLeft, right: vv.offsetLeft + vv.width, bottom: vv.offsetTop + vv.height };
  const inside = (b) => b.top >= area.top - 1 && b.left >= area.left - 1 && b.top + b.height <= area.bottom + 1 && b.left + b.width <= area.right + 1;

  ok('body scroll locked', dom.body.classList.contains('tour-open'));

  for (let i = 0; i < TARGETS.length; i++) {
    if (i > 0) dom.bits['tour-next'].click();
    const hl = boxOf(dom.highlight);
    const card = boxOf(dom.card);
    const stepLabel = `step ${i}${TARGETS[i] ? ' ' + TARGETS[i] : ''}`;
    if (i === 0) {
      ok(`${stepLabel}: full scrim`, dom.highlight.classList.contains('full'));
    } else {
      ok(`${stepLabel}: cut-out inside visible area`, inside(hl), JSON.stringify(hl) + ' area ' + JSON.stringify(area));
      // on a very short visible area the card physically cannot avoid the
      // cut-out — then it must at least take the side with the least overlap
      const rect = dom.targets[TARGETS[i]].getBoundingClientRect();
      const rectBottom = Math.min(rect.bottom, area.bottom);
      const rectTop = Math.max(rect.top, area.top);
      const margin = 12, pad = 6;
      // overlap if the card sits as low/high as the visible area allows
      const overlapBelow = Math.max(0, (rectBottom + pad) - (area.bottom - card.height - margin));
      const overlapAbove = Math.max(0, (area.top + margin + card.height) - (rectTop - pad));
      const minOverlap = Math.min(overlapBelow, overlapAbove);
      const ov = Math.max(0, Math.min(card.top + card.height, hl.top + hl.height) - Math.max(card.top, hl.top));
      ok(`${stepLabel}: card covers spotlight by at most the unavoidable ${Math.round(minOverlap)}px`, ov <= minOverlap + 1, `overlap ${ov} card ${JSON.stringify(card)} hl ${JSON.stringify(hl)}`);
    }
    ok(`${stepLabel}: card inside visible area`, inside(card), JSON.stringify(card) + ' area ' + JSON.stringify(area));
    if (c.phone) {
      ok(`${stepLabel}: sheet is full-width`, Math.abs(card.width - (vv.width - 24)) < 0.5, `width ${card.width} want ${vv.width - 24}`);
    }
  }

  // browser chrome reflows mid-tour: the layout must follow
  if (dom.win.visualViewport) {
    const vh = dom.win.visualViewport;
    vh.height = Math.round(vh.height * 0.8);
    const onResize = dom.vvListeners.resize;
    ok('visualViewport resize listener registered', typeof onResize === 'function');
    if (onResize) onResize();
    const card = boxOf(dom.card);
    const newAreaBottom = vv.offsetTop + vh.height;
    ok('card follows visual-viewport reflow', card.top + card.height <= newAreaBottom + 1 && card.top >= vv.offsetTop - 1, JSON.stringify(card) + ' newBottom ' + newAreaBottom);
  }

  // finishing tears everything down
  dom.bits['tour-next'].click(); // last step -> finish
  ok('overlay removed on finish', dom.body.lastChild.gone === true);
  ok('body unlocked on finish', !dom.body.classList.contains('tour-open'));
  ok('listeners removed', !dom.docListeners.keydown && !dom.winListeners.resize && !dom.winListeners.scroll && !dom.vvListeners.resize);
  ok('onComplete reported', completed === true);
}

console.log(failures ? `\n${failures} FAILURES` : '\nall tour layout checks passed');
process.exit(failures ? 1 : 0);
