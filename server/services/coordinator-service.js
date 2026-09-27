'use strict';

const { ConflictError, NotFoundError, ValidationError } = require('../core/errors');

/** Use cases for the people who handle shoots. */
class CoordinatorService {
  /**
   * @param {{ coordinatorRepository: import('../repositories/coordinator-repository').CoordinatorRepository,
   *           shootRepository: import('../repositories/shoot-repository').ShootRepository }} deps
   */
  constructor({ coordinatorRepository, shootRepository }) {
    this.coordinatorRepository = coordinatorRepository;
    this.shootRepository = shootRepository;
  }

  list() {
    return this.coordinatorRepository.list();
  }

  /** @returns {Promise<{ id: number, name: string }>} */
  async upsert(body = {}) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) throw new ValidationError('name required');
    return this.coordinatorRepository.upsert({
      name,
      email: body.email || null,
      phone: body.phone || null,
      notes: body.notes || null
    });
  }

  /**
   * Coordinators referenced by a shoot are kept: deleting one would silently
   * unassign historical work.
   *
   * @returns {Promise<{ id: number, name: string }>} the deleted coordinator
   */
  async remove(id) {
    const shootCount = await this.shootRepository.countByCoordinator(id);
    if (shootCount > 0) {
      throw new ConflictError(`coordinator has ${shootCount} shoot(s) and cannot be deleted`);
    }
    const deleted = await this.coordinatorRepository.deleteById(id);
    if (!deleted) throw new NotFoundError();
    return deleted;
  }
}

module.exports = { CoordinatorService };
