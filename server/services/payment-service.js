'use strict';

const { NotFoundError, ValidationError } = require('../core/errors');

/**
 * Use cases for the earnings ledger.
 *
 * The ledger is scoped through its shoots: a payment can only be booked on —
 * or removed from — a shoot in the caller's write scope. That is the caller's
 * own data, or the data an owner is viewing (so an owner can settle a member's
 * ledger while looking at it). Everything else is invisible (404).
 */
class PaymentService {
  /**
   * @param {{ paymentRepository: import('../repositories/payment-repository').PaymentRepository,
   *           shootRepository: import('../repositories/shoot-repository').ShootRepository }} deps
   */
  constructor({ paymentRepository, shootRepository }) {
    this.paymentRepository = paymentRepository;
    this.shootRepository = shootRepository;
  }

  /**
   * @param {number} shootId
   * @param {{ amount: unknown, paid_on?: string, method?: string, note?: string }} body
   * @param {import('../domain/data-scope').DataScope} scope
   * @returns {Promise<{ id: number }>}
   */
  async record(shootId, body = {}, scope) {
    const { amount, paid_on: paidOn, method, note } = body;
    if (amount === undefined || amount === null || amount === '') {
      throw new ValidationError('amount required');
    }
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new ValidationError('amount must be a number of 0 or more');
    }
    const shoot = await this.shootRepository.findById(shootId);
    if (!shoot || shoot.owner_id !== scope.writeId) throw new NotFoundError();

    const id = await this.paymentRepository.insert({
      shoot_id: shootId,
      amount: parsed,
      paid_on: paidOn || null,
      method: method || null,
      note: note || null
    });
    return { id };
  }

  /** @throws {NotFoundError} when the payment does not exist or is not the caller's */
  async remove(paymentId, scope) {
    const owner = await this.paymentRepository.ownerOfPayment(paymentId);
    if (owner !== scope.writeId) throw new NotFoundError();
    const deleted = await this.paymentRepository.deleteById(paymentId);
    if (!deleted) throw new NotFoundError();
  }
}

module.exports = { PaymentService };
