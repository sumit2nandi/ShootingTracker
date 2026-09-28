'use strict';

const { SHOOT_STATUSES } = require('../domain/shoot-status');

/** Supplies the values the filter bar and the shoot form offer. */
class MetadataService {
  /** @param {{ metadataRepository: import('../repositories/metadata-repository').MetadataRepository }} deps */
  constructor({ metadataRepository }) {
    this.metadataRepository = metadataRepository;
  }

  /**
   * Everything is scoped to the account whose data is being viewed — including
   * the coordinator list (the coordinators that account has used in its own
   * shoots) and the past titles offered as suggestions while typing a new one.
   *
   * @param {import('../domain/data-scope').DataScope} scope
   */
  async describe(scope) {
    const [coordinators, clients, types, months, titles, titleSuggestions] = await Promise.all([
      this.metadataRepository.distinctCoordinators(scope.targetId),
      this.metadataRepository.distinctClients(scope.targetId),
      this.metadataRepository.distinctTypes(scope.targetId),
      this.metadataRepository.months(scope.targetId),
      this.metadataRepository.pastTitles(scope.targetId),
      this.metadataRepository.titleSuggestions(scope.targetId)
    ]);
    return { statuses: [...SHOOT_STATUSES], coordinators, clients, types, months, titles, titleSuggestions };
  }
}

module.exports = { MetadataService };
