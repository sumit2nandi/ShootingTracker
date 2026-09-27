'use strict';

const { NotFoundError, ValidationError } = require('../core/errors');

/** Use cases for the earnings ledger. */
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
   * @returns {Promise<{ id: number }>}
   */
  async record(shootId, body = {}) {
    const { amount, paid_on: paidOn, method, note } = body;
    if (amount === undefined || amount === null || amount === '') {
      throw new ValidationError('amount required');
    }
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new ValidationError('amount must be a number of 0 or more');
    }
    if (!(await this.shootRepository.existsById(shootId))) throw new NotFoundError();

    const id = await this.paymentRepository.insert({
      shoot_id: shootId,
      amount: parsed,
      paid_on: paidOn || null,
      method: method || null,
      note: note || null
    });
    return { id };
  }

  /** @throws {NotFoundError} when the payment does not exist */
  async remove(paymentId) {
    const deleted = await this.paymentRepository.deleteById(paymentId);
    if (!deleted) throw new NotFoundError();
  }
}

module.exports = { PaymentService };
