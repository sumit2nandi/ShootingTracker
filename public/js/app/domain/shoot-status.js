/**
 * The client-side half of the status vocabulary (mirrors
 * `server/domain/shoot-status.js`).
 */
import { escapeHtml } from '../core/dom.js';

export const STATUS_COLORS = { planned: '#7b8ea3', completed: '#15803d' };
export const STATUS_ORDER = Object.keys(STATUS_COLORS);
export const PAYMENT_FILTERS = ['paid', 'partial', 'unpaid', 'outstanding'];

export const statusLabel = (status) =>
  String(status || '').charAt(0).toUpperCase() + String(status || '').slice(1);

/**
 * Rows imported before the app settled on two states may still carry
 * "confirmed" / "postponed" / "cancelled"; fold them so every screen, filter
 * and legend only ever shows the two real states.
 */
export const appStatus = (status) => (status === 'completed' || status === 'cancelled' ? 'completed' : 'planned');

export const statusPill = (status) =>
  `<span class="pill ${appStatus(status)}">${escapeHtml(statusLabel(appStatus(status)))}</span>`;

export const paymentLabel = (paymentStatus) =>
  paymentStatus === 'partial' ? 'Partially Paid' : statusLabel(paymentStatus);
