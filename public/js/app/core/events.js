/**
 * Minimal publish/subscribe.
 *
 * Views announce what happened ("a shoot was saved") instead of calling each
 * other, so adding a listener never means editing the emitter.
 */
export class EventBus {
  constructor() {
    this.listeners = new Map();
  }

  /** @returns {() => void} an unsubscribe function */
  on(event, handler) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(handler);
    return () => this.off(event, handler);
  }

  off(event, handler) {
    const handlers = this.listeners.get(event);
    if (handlers) handlers.delete(handler);
  }

  emit(event, payload) {
    for (const handler of this.listeners.get(event) || []) handler(payload);
  }
}
