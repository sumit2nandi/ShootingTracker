import { EventBus } from './events.js';

/**
 * The single source of truth for UI state.
 *
 * State is only ever replaced through `update()`, which notifies subscribers —
 * so "who changed this?" has one answer, and views never read each other's
 * fields.
 */
export class Store {
  constructor(initialState = {}) {
    this.state = { ...initialState };
    this.bus = new EventBus();
  }

  get() {
    return this.state;
  }

  /** Shallow-merge a patch and notify subscribers. */
  update(patch) {
    this.state = { ...this.state, ...patch };
    this.bus.emit('change', this.state);
    return this.state;
  }

  subscribe(handler) {
    return this.bus.on('change', handler);
  }
}
