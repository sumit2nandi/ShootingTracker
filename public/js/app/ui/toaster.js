import { $ } from '../core/dom.js';

/** Transient messages. Owns one container element and nothing else. */
export class Toaster {
  constructor({ container = $('#toasts'), timeoutMs = 4200 } = {}) {
    this.container = container;
    this.timeoutMs = timeoutMs;
  }

  show(message, kind = 'ok') {
    if (!this.container) return;
    const element = document.createElement('div');
    element.className = `toast ${kind}`;
    element.textContent = message;
    this.container.appendChild(element);
    setTimeout(() => {
      element.classList.add('leaving');
      setTimeout(() => element.remove(), 300);
    }, this.timeoutMs);
  }

  success(message) {
    this.show(message, 'ok');
  }

  /** Neutral notice (hints) — no good-news, bad-news tint. */
  info(message) {
    this.show(message, 'info');
  }

  error(message) {
    this.show(message, 'err');
  }
}
