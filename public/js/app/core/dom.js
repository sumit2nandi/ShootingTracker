/** Thin DOM helpers shared by every view. No state, no side effects. */

export const $ = (selector, root = document) => root.querySelector(selector);

export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape text before it goes into an HTML template string. */
export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ENTITIES[char]);

/** Escaped, trimmed text — '' when there is nothing to show. */
export const text = (value) => {
  const trimmed = String(value ?? '').trim();
  return trimmed ? escapeHtml(trimmed) : '';
};

/** Attach the same handler to every element matching `selector`. */
export function on(root, selector, event, handler) {
  $$(selector, root).forEach((element) => element.addEventListener(event, handler));
}

/** Toggle an element's `hidden` state safely (it may not exist in every layout). */
export function setHidden(element, hidden) {
  if (element) element.hidden = hidden;
}
