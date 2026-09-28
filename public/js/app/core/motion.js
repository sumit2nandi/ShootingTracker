/**
 * Motion helpers.
 *
 * The CSS owns what an animation looks like; this module owns *when* one has to
 * be coordinated with the DOM — an overlay that may only be hidden after its
 * exit animation, and a `<details>` element the browser would otherwise snap
 * open. Everything degrades: without the Web Animations API, or when the
 * visitor asked for reduced motion, the same interactions still work instantly.
 */

/** Honour the OS "reduce motion" setting (checked per call, it can change). */
export const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Longest exit animation in the stylesheet; the fallback timer outlives it. */
const EXIT_MS = 200;

/** Show an overlay (scrim + panel); the enter animation lives in the CSS. */
export function openOverlay(element) {
  if (!element) return;
  element.classList.remove('closing');
  element.classList.remove('hidden');
}

/**
 * Hide an overlay *after* its exit animation, so a sheet slides away instead of
 * blinking out.
 */
export function closeOverlay(element) {
  if (!element || element.classList.contains('hidden') || element.classList.contains('closing')) return;
  if (prefersReducedMotion()) {
    element.classList.add('hidden');
    return;
  }

  element.classList.add('closing');
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    element.classList.remove('closing');
    element.classList.add('hidden');
  };

  const panel = element.firstElementChild;
  if (panel && typeof panel.addEventListener === 'function') {
    panel.addEventListener('animationend', finish, { once: true });
  }
  setTimeout(finish, EXIT_MS + 120); // in case the animation never runs (hidden tab, no support)
}

/**
 * Make a `<details>` expand and collapse smoothly.
 *
 * The element keeps working exactly as before — it is still a native
 * disclosure, still keyboard accessible; the click is only intercepted long
 * enough to animate the height of its body.
 *
 * @param {HTMLDetailsElement} details with a single element wrapping its content
 */
export function animateDisclosure(details, { duration = 240 } = {}) {
  if (!details || details.dataset.motion === 'on') return;
  const summary = details.querySelector('summary');
  const body = [...details.children].find((child) => child !== summary);
  if (!summary || !body || typeof body.animate !== 'function') return;
  details.dataset.motion = 'on';

  summary.addEventListener('click', (event) => {
    if (prefersReducedMotion()) return; // let the browser toggle it instantly
    if (details.dataset.animating) {
      event.preventDefault();
      return;
    }
    event.preventDefault();

    const collapsing = details.open;
    details.dataset.animating = '1';
    if (!collapsing) details.open = true; // open first, so the body can be measured

    const height = `${body.scrollHeight}px`;
    const frames = collapsing
      ? [{ height, opacity: 1 }, { height: '0px', opacity: 0 }]
      : [{ height: '0px', opacity: 0 }, { height, opacity: 1 }];

    body.style.overflow = 'hidden';
    const animation = body.animate(frames, { duration, easing: 'cubic-bezier(.2, .8, .2, 1)' });
    const settle = () => {
      details.open = !collapsing;
      body.style.overflow = '';
      delete details.dataset.animating;
    };
    animation.addEventListener('finish', settle, { once: true });
    animation.addEventListener('cancel', settle, { once: true });
  });
}
