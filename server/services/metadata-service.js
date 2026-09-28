'use strict';

const { SHOOT_STATUSES } = require('../domain/shoot-status');

/** Supplies the values the filter bar offers. */
class MetadataService {
  /**
   * @param {{ metadataRepository: import('../repositories/metadata-repository').MetadataRepository,
   *           coordinatorRepository: import('../repositories/coordinator-repository').CoordinatorRepository }} deps
   */
  constructor({ metadataRepository, coordinatorRepository }) {
    this.metadataRepository = metadataRepository;
    this.coordinatorRepository = coordinatorRepository;
  }

  /**
   * Coordinators stay global (shared reference data); clients, types and
   * months come from the account whose data is being viewed.
   *
   * @param {import('../domain/data-scope').DataScope} scope
   */
  async describe(scope) {
    const [coordinators, clients, types, months] = await Promise.all([
      this.coordinatorRepository.list(),
      this.metadataRepository.distinctClients(scope.targetId),
      this.metadataRepository.distinctTypes(scope.targetId),
      this.metadataRepository.months(scope.targetId)
    ]);
    return { statuses: [...SHOOT_STATUSES], coordinators, clients, types, months };
  }
}

module.exports = { MetadataService };
