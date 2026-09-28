'use strict';

const { withTranslatedErrors } = require('../persistence/pg-error-translator');

/** SQL for the per-shoot earnings ledger. */
class PaymentRepository {
  /** @param {{ database: import('../persistence/postgres-database').Database }} deps */
  constructor({ database }) {
    this.database = database;
  }

  async listByShoot(shootId) {
    const result = await this.database.query(
      'SELECT * FROM payments WHERE shoot_id = $1 ORDER BY paid_on DESC, id DESC',
      [shootId]
    );
    return result.rows;
  }

  /**
   * @param {{ shoot_id: number, amount: number, paid_on?: string|null, method?: string|null, note?: string|null }} payment
   * @param {{ query: Function }} [executor]
   * @returns {Promise<number>} the new payment id
   */
  async insert(payment, executor = this.database) {
    const result = await withTranslatedErrors(() =>
      executor.query(
        `INSERT INTO payments (shoot_id, amount, paid_on, method, note)
         VALUES ($1, $2, COALESCE($3::date, CURRENT_DATE), $4, $5) RETURNING id`,
        [
          payment.shoot_id,
          payment.amount,
          payment.paid_on || null,
          payment.method || null,
          payment.note || null
        ]
      )
    );
    return result.rows[0].id;
  }

  /**
   * The `owner_id` of the shoot a payment belongs to.
   *
   * @returns {Promise<number|null>} null when the payment does not exist
   */
  async ownerOfPayment(id) {
    const result = await this.database.query(
      'SELECT s.owner_id FROM payments p JOIN shoots s ON s.id = p.shoot_id WHERE p.id = $1',
      [id]
    );
    return result.rows.length ? result.rows[0].owner_id : null;
  }

  /** @returns {Promise<boolean>} whether a row was deleted */
  async deleteById(id) {
    const result = await this.database.query('DELETE FROM payments WHERE id = $1', [id]);
    return result.rowCount > 0;
  }
}

module.exports = { PaymentRepository };
