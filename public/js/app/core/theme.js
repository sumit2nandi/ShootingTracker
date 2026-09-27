/**
 * Light/dark theme.
 *
 * The stored choice wins; with nothing stored we follow the operating system.
 * Storage access is wrapped because private mode can throw on access.
 */
export class ThemeController {
  constructor({ storageKey = 'shootingtracker-theme', root = document.documentElement, storage = safeStorage(), media = window.matchMedia('(prefers-color-scheme: dark)') } = {}) {
    this.storageKey = storageKey;
    this.root = root;
    this.storage = storage;
    this.media = media;
    this.listeners = new Set();
  }

  get stored() {
    const value = this.storage.get(this.storageKey);
    return value === 'light' || value === 'dark' ? value : null;
  }

  get current() {
    return this.stored || (this.media.matches ? 'dark' : 'light');
  }

  apply(theme, persist = false) {
    const dark = theme === 'dark';
    this.root.setAttribute('data-theme', dark ? 'dark' : 'light');
    if (persist) this.storage.set(this.storageKey, dark ? 'dark' : 'light');
    this.listeners.forEach((listener) => listener(dark ? 'dark' : 'light'));
  }

  toggle() {
    this.apply(this.current === 'dark' ? 'light' : 'dark', true);
  }

  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Follow the OS while the visitor has not picked a side. */
  start() {
    this.apply(this.current);
    this.media.addEventListener('change', (event) => {
      if (!this.stored) this.apply(event.matches ? 'dark' : 'light');
    });
  }
}

function safeStorage() {
  return {
    get(key) {
      try {
        return localStorage.getItem(key);
      } catch {
        return null; // storage blocked (private mode)
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch {
        /* ignore */
      }
    }
  };
}
