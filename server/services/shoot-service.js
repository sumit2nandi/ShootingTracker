'use strict';

const { NotFoundError } = require('../core/errors');
const { ShootFilter } = require('../domain/shoot-filter');
const { ShootInput } = require('../domain/shoot-input');

/**
 * Use cases for shoots — always inside a {@link import('../domain/data-scope').DataScope}.
 *
 * Reads are scoped to `scope.targetId`: a member sees their own data, an owner
 * sees their own or, when they chose to view another account, that account's.
 * Writes always belong to `scope.selfId` — nobody can create, edit or delete
 * a shoot through another account's data, even an owner while viewing it.
 *
 * A shoot outside the scope is indistinguishable from a missing one (404), so
 * an id can never be used to probe another account's records.
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

  /**
   * @param {Record<string, string>} query filter parameters straight from the request
   * @param {import('../domain/data-scope').DataScope} scope
   */
  list(query, scope) {
    return this.shootRepository.findMany(ShootFilter.fromQuery({ ...query, owner: scope.filterOwner }));
  }

  /**
   * @returns {Promise<object>} shoot + payments + media @throws {NotFoundError}
   */
  async getDetail(id, scope) {
    const shoot = await this.shootRepository.findById(id);
    if (!shoot || shoot.owner_id !== scope.targetId) throw new NotFoundError();
    const [payments, media] = await Promise.all([
      this.paymentRepository.listByShoot(id),
      this.mediaRepository.listByShoot(id)
    ]);
    return { ...shoot, payments, media };
  }

  /**
   * @returns {Promise<{ id: number }>}
   */
  async create(body, scope) {
    const input = ShootInput.forCreate(body);
    const id = await this.database.withTransaction(async (executor) => {
      const values = await this.#withResolvedCoordinator(input, executor);
      values.owner_id = scope.selfId; // a new shoot always belongs to the person who made it
      return this.shootRepository.insert(values, executor);
    });
    return { id };
  }

  /** @throws {NotFoundError} when the shoot does not exist or is not the caller's */
  async update(id, body, scope) {
    await this.#assertOwnsShoot(id, scope);
    const input = ShootInput.forUpdate(body);
    const updated = await this.database.withTransaction(async (executor) => {
      const values = await this.#withResolvedCoordinator(input, executor);
      return this.shootRepository.update(id, values, executor);
    });
    if (!updated) throw new NotFoundError();
  }

  /** @throws {NotFoundError} when the shoot does not exist or is not the caller's */
  async remove(id, scope) {
    await this.#assertOwnsShoot(id, scope);
    const deleted = await this.shootRepository.deleteById(id);
    if (!deleted) throw new NotFoundError();
  }

  /**
   * The write-side gate: fetches the shoot and refuses anything that is not
   * the caller's own, answering 404 either way.
   */
  async #assertOwnsShoot(id, scope) {
    const shoot = await this.shootRepository.findById(id);
    if (!shoot || shoot.owner_id !== scope.selfId) throw new NotFoundError();
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
