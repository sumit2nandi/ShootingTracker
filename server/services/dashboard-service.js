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
    const today = validDateKey(query.today);
    const [kpi, monthly, byCoordinator, byType, byStatus, upcoming, attention] = await Promise.all([
      this.analyticsRepository.kpis(filter),
      this.analyticsRepository.monthlyTotals(filter),
      this.analyticsRepository.totalsByCoordinator(filter),
      this.analyticsRepository.totalsByType(filter),
      this.analyticsRepository.countsByStatus(filter),
      this.analyticsRepository.upcoming(filter, 8, today),
      this.analyticsRepository.needsAttention(filter, 8, today)
    ]);
    return { kpi, monthly, byCoordinator, byType, byStatus, upcoming, attention };
  }
}

function validDateKey(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? undefined : value;
}

module.exports = { DashboardService, validDateKey };
