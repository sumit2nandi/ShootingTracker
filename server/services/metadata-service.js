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

  async describe() {
    const [coordinators, clients, types, months] = await Promise.all([
      this.coordinatorRepository.list(),
      this.metadataRepository.distinctClients(),
      this.metadataRepository.distinctTypes(),
      this.metadataRepository.months()
    ]);
    return { statuses: [...SHOOT_STATUSES], coordinators, clients, types, months };
  }
}

module.exports = { MetadataService };
