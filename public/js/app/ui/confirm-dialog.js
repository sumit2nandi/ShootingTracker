import { $, $$ } from '../core/dom.js';
import { closeOverlay, openOverlay } from '../core/motion.js';

/** Promise-based, in-app replacement for native browser confirmations. */
export class ConfirmDialog {
  constructor() {
    this.modal = $('#confirm-modal');
    this.title = $('#confirm-title');
    this.message = $('#confirm-message');
    this.cancelButton = $('#confirm-cancel');
    this.confirmButton = $('#confirm-accept');
    this.resolve = null;
    this.previousFocus = null;
    this.onKeydown = (event) => this.#onKeydown(event);
  }

  mount() {
    this.cancelButton.addEventListener('click', () => this.#finish(false));
    this.confirmButton.addEventListener('click', () => this.#finish(true));
    this.modal.addEventListener('click', (event) => {
      if (event.target === this.modal) this.#finish(false);
    });
  }

  ask(message, { title = 'Please confirm', confirmLabel = 'Confirm', cancelLabel = 'Cancel' } = {}) {
    if (this.resolve) this.#finish(false);
    this.title.textContent = title;
    this.message.textContent = message;
    this.confirmButton.textContent = confirmLabel;
    this.cancelButton.textContent = cancelLabel;
    this.previousFocus = document.activeElement;
    openOverlay(this.modal);
    document.addEventListener('keydown', this.onKeydown);
    this.cancelButton.focus();

    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  #onKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.#finish(false);
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = $$('.confirm-dialog button:not(:disabled)', this.modal);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  #finish(confirmed) {
    if (!this.resolve) return;
    const resolve = this.resolve;
    this.resolve = null;
    document.removeEventListener('keydown', this.onKeydown);
    closeOverlay(this.modal);
    resolve(confirmed);
    this.previousFocus?.focus?.();
  }
}
