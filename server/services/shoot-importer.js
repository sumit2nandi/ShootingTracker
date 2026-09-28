'use strict';

const { coerceShootStatus } = require('../domain/shoot-status');

/**
 * Writes parsed rows into the database, idempotently.
 *
 *  - coordinators are upserted by `lower(name)`
 *  - shoots are inserted with `ON CONFLICT (dedupe_hash) DO NOTHING`
 *  - payments are only written for shoots that were actually created
 *
 * A row that fails is recorded in `errors` and the rest continue — a single bad
 * line must not lose an entire sheet.
 */
class ShootImporter {
  /**
   * @param {{ database: import('../persistence/postgres-database').Database,
   *           shootRepository: import('../repositories/shoot-repository').ShootRepository,
   *           paymentRepository: import('../repositories/payment-repository').PaymentRepository,
   *           coordinatorRepository: import('../repositories/coordinator-repository').CoordinatorRepository }} deps
   */
  constructor({ database, shootRepository, paymentRepository, coordinatorRepository }) {
    this.database = database;
    this.shootRepository = shootRepository;
    this.paymentRepository = paymentRepository;
    this.coordinatorRepository = coordinatorRepository;
  }

  /**
   * @param {object[]} rows rows produced by {@link SheetParser}
   * @param {number} [ownerId] app_users id the imported data belongs to;
   *        null (the CLI without `--owner`) leaves rows unassigned, and the
   *        UI passes the signed-in account's id
   * @returns {Promise<{ inserted: number, skipped: number, payments: number, coordinators: string[], errors: object[] }>}
   */
  async import(rows, ownerId = null) {
    const summary = { inserted: 0, skipped: 0, payments: 0, coordinators: new Set(), errors: [] };

    await this.database.withTransaction(async (executor) => {
      for (const row of rows) {
        try {
          const coordinatorId = row.coordinator
            ? await this.coordinatorRepository.upsertByName(row.coordinator, executor)
            : null;
          if (coordinatorId !== null && row.coordinator) summary.coordinators.add(row.coordinator);

          const shootId = await this.shootRepository.insertImported(
            {
              title: row.title,
              client_name: row.client_name || null,
              shoot_type: row.shoot_type || null,
              shoot_date: row.shoot_date,
              end_date: row.end_date || null,
              start_time: row.start_time || null,
              end_time: row.end_time || null,
              venue: row.venue || null,
              location: row.location || null,
              coordinator_id: coordinatorId,
              fee: row.fee || 0,
              status: coerceShootStatus(row.status),
              contact_name: row.contact_name || null,
              contact_phone: row.contact_phone || null,
              notes: row.notes || null,
              owner_id: ownerId,
              extra: row.extra || {},
              dedupe_hash: row.dedupe_hash || null
            },
            executor
          );

          if (shootId === null) {
            summary.skipped++;
            continue;
          }
          summary.inserted++;

          for (const payment of row.payments || []) {
            await this.paymentRepository.insert({ ...payment, shoot_id: shootId }, executor);
            summary.payments++;
          }
        } catch (error) {
          summary.errors.push({ title: row.title, date: row.shoot_date, error: error.message });
        }
      }
    });

    return { ...summary, coordinators: [...summary.coordinators] };
  }
}

module.exports = { ShootImporter };
