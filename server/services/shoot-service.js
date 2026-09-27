'use strict';

const { NotFoundError } = require('../core/errors');
const { ShootFilter } = require('../domain/shoot-filter');
const { ShootInput } = require('../domain/shoot-input');

/**
 * Use cases for shoots.
 *
 * Owns the rules that span more than one table — "creating a shoot with a new
 * coordinator name is one atomic step", "a detail view is the shoot plus its
 * ledger and media" — while repositories own the SQL and the HTTP layer owns
 * request/response translation.
 */
class ShootService {
  /**
   * @param {{ database: import('../persistence/postgres-database').Database,
   *           shootRepository: import('../repositories/shoot-repository').ShootRepository,
   *           paymentRepository: import('../repositories/payment-repository').PaymentRepository,
   *           mediaRepository: import('../repositories/media-repository').MediaRepository,
   *           coordinatorRepository: import('../repositories/coordinator-repository').CoordinatorRepository }} deps
   */
  constructor({ database, shootRepository, paymentRepository, mediaRepository, coordinatorRepository }) {
    this.database = database;
    this.shootRepository = shootRepository;
    this.paymentRepository = paymentRepository;
    this.mediaRepository = mediaRepository;
    this.coordinatorRepository = coordinatorRepository;
  }

  /** @param {Record<string, string>} query filter parameters straight from the request */
  list(query) {
    return this.shootRepository.findMany(ShootFilter.fromQuery(query));
  }

  /** @returns {Promise<object>} shoot + payments + media @throws {NotFoundError} */
  async getDetail(id) {
    const shoot = await this.shootRepository.findById(id);
    if (!shoot) throw new NotFoundError();
    const [payments, media] = await Promise.all([
      this.paymentRepository.listByShoot(id),
      this.mediaRepository.listByShoot(id)
    ]);
    return { ...shoot, payments, media };
  }

  /** @returns {Promise<{ id: number }>} */
  async create(body) {
    const input = ShootInput.forCreate(body);
    const id = await this.database.withTransaction(async (executor) => {
      const values = await this.#withResolvedCoordinator(input, executor);
      return this.shootRepository.insert(values, executor);
    });
    return { id };
  }

  /** @throws {NotFoundError} when the shoot does not exist */
  async update(id, body) {
    const input = ShootInput.forUpdate(body);
    const updated = await this.database.withTransaction(async (executor) => {
      const values = await this.#withResolvedCoordinator(input, executor);
      return this.shootRepository.update(id, values, executor);
    });
    if (!updated) throw new NotFoundError();
  }

  /** @throws {NotFoundError} when the shoot does not exist */
  async remove(id) {
    const deleted = await this.shootRepository.deleteById(id);
    if (!deleted) throw new NotFoundError();
  }

  /**
   * A coordinator given by name is created on first use, inside the caller's
   * transaction, so a failed insert never leaves an orphan coordinator behind.
   */
  async #withResolvedCoordinator(input, executor) {
    const values = { ...input.values };
    if (input.coordinatorName === undefined) return values;
    values.coordinator_id = input.coordinatorName
      ? await this.coordinatorRepository.upsertByName(input.coordinatorName, executor)
      : null;
    return values;
  }
}

module.exports = { ShootService };
