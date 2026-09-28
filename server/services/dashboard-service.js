'use strict';

const { ShootFilter } = require('../domain/shoot-filter');

/**
 * Assembles the dashboard payload.
 *
 * One filter is parsed once and handed to every aggregate, which is what makes
 * "every widget respects the filter bar" true by construction instead of by
 * repetition.
 */
class DashboardService {
  /** @param {{ analyticsRepository: import('../repositories/analytics-repository').AnalyticsRepository }} deps */
  constructor({ analyticsRepository }) {
    this.analyticsRepository = analyticsRepository;
  }

  /**
   * @param {Record<string, string>} query
   * @param {import('../domain/data-scope').DataScope} scope the account whose data the dashboard shows
   */
  async summarize(query, scope) {
    const filter = ShootFilter.fromQuery({ ...query, owner: scope.filterOwner });
    const [kpi, monthly, byCoordinator, byType, byStatus, upcoming, attention] = await Promise.all([
      this.analyticsRepository.kpis(filter),
      this.analyticsRepository.monthlyTotals(filter),
      this.analyticsRepository.totalsByCoordinator(filter),
      this.analyticsRepository.totalsByType(filter),
      this.analyticsRepository.countsByStatus(filter),
      this.analyticsRepository.upcoming(filter),
      this.analyticsRepository.needsAttention(filter)
    ]);
    return { kpi, monthly, byCoordinator, byType, byStatus, upcoming, attention };
  }
}

module.exports = { DashboardService };
