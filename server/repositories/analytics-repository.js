'use strict';

const { BASE_CTE } = require('./shoot-queries');

/** Rows imported before the two-state model may still say 'confirmed'. */
const STILL_OPEN = `b.status IN ('planned','confirmed')`;
const OWES_MONEY = `b.fee > 0 AND b.paid_amount < b.fee`;

/**
 * The next seven days: everything still to happen, plus *everything* booked for
 * today whatever state it is in — today's schedule stays on screen all day, so
 * a shoot ticked off in the evening does not vanish mid-tap.
 */
const UPCOMING_WINDOW =
  `b.shoot_date >= CURRENT_DATE AND b.shoot_date < (CURRENT_DATE + 7)
   AND (${STILL_OPEN} OR b.shoot_date = CURRENT_DATE)`;

/**
 * Work that has slipped: a past shoot nobody closed, or a finished shoot whose
 * fee is still outstanding.
 */
const ATTENTION_WINDOW =
  `(b.shoot_date < CURRENT_DATE AND ${STILL_OPEN})
   OR (b.status = 'completed' AND ${OWES_MONEY} AND b.shoot_date <> CURRENT_DATE)`;

/**
 * Read-only aggregate queries behind the dashboard.
 *
 * Separate from {@link ShootRepository} because the reasons to change differ:
 * this one follows the dashboard widgets, that one follows the shoot record.
 */
class AnalyticsRepository {
  /** @param {{ database: import('../persistence/postgres-database').Database }} deps */
  constructor({ database }) {
    this.database = database;
  }

  /** @param {import('../domain/shoot-filter').ShootFilter} filter */
  async kpis(filter) {
    const { where, params } = filter.toSql();
    const result = await this.database.query(
      `${BASE_CTE}
      SELECT COUNT(*)::int AS shoots,
             COALESCE(SUM(fee),0)::numeric AS total_fee,
             COALESCE(SUM(paid_amount),0)::numeric AS total_paid,
             COALESCE(SUM(fee - LEAST(paid_amount, fee)),0)::numeric AS outstanding,
             COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
             COUNT(*) FILTER (WHERE status = 'planned')::int AS active,
             COUNT(*) FILTER (WHERE payment_status = 'paid')::int AS paidShoots,
             COUNT(*) FILTER (WHERE payment_status = 'unpaid')::int AS unpaidShoots,
             COUNT(*) FILTER (WHERE fee > 0 AND paid_amount < fee)::int AS outstandingShoots
      FROM base b ${where}`,
      params
    );
    return result.rows[0];
  }

  async monthlyTotals(filter) {
    const { where, params } = filter.toSql();
    const result = await this.database.query(
      `${BASE_CTE}
      SELECT to_char(shoot_date, 'YYYY-MM') AS ym,
             COUNT(*)::int AS shoots,
             COALESCE(SUM(fee),0)::numeric AS fee,
             COALESCE(SUM(paid_amount),0)::numeric AS paid
      FROM base b ${where}
      GROUP BY 1 ORDER BY 1 DESC LIMIT 36`,
      params
    );
    return result.rows;
  }

  async totalsByCoordinator(filter) {
    const { where, params } = filter.toSql();
    const result = await this.database.query(
      `${BASE_CTE}
      SELECT COALESCE(NULLIF(coordinator,''), 'Unassigned') AS name,
             COUNT(*)::int AS shoots,
             COALESCE(SUM(fee),0)::numeric AS fee,
             COALESCE(SUM(paid_amount),0)::numeric AS paid
      FROM base b ${where}
      GROUP BY 1 ORDER BY fee DESC LIMIT 25`,
      params
    );
    return result.rows;
  }

  async totalsByType(filter) {
    const { where, params } = filter.toSql();
    const result = await this.database.query(
      `${BASE_CTE}
      SELECT COALESCE(NULLIF(shoot_type,''), 'Other') AS type,
             COUNT(*)::int AS shoots,
             COALESCE(SUM(fee),0)::numeric AS fee
      FROM base b ${where}
      GROUP BY 1 ORDER BY shoots DESC LIMIT 25`,
      params
    );
    return result.rows;
  }

  async countsByStatus(filter) {
    const { where, params } = filter.toSql();
    const result = await this.database.query(
      `${BASE_CTE}
      SELECT status, COUNT(*)::int AS n
      FROM base b ${where}
      GROUP BY 1 ORDER BY n DESC`,
      params
    );
    return result.rows;
  }

  /** Shoots in the next seven days that still have to happen. */
  async upcoming(filter, limit = 8) {
    const { where, params } = filter.toSql({ extraConditions: [UPCOMING_WINDOW] });
    const result = await this.database.query(
      `${BASE_CTE}
      SELECT b.id, b.title, b.client_name, b.shoot_date, b.venue, b.location,
             b.coordinator, b.fee, b.paid_amount, b.status, b.payment_status
      FROM base b ${where}
      ORDER BY b.shoot_date ASC LIMIT ${Number(limit) || 8}`,
      params
    );
    return result.rows;
  }

  /** Shoots that have slipped: overdue, or finished but unpaid. */
  async needsAttention(filter, limit = 8) {
    const { where, params } = filter.toSql({ extraConditions: [`(${ATTENTION_WINDOW})`] });
    const result = await this.database.query(
      `${BASE_CTE}
      SELECT b.id, b.title, b.client_name, b.shoot_date, b.venue, b.location,
             b.coordinator, b.fee, b.paid_amount, b.status, b.payment_status
      FROM base b ${where}
      ORDER BY b.shoot_date DESC LIMIT ${Number(limit) || 8}`,
      params
    );
    return result.rows;
  }
}

module.exports = { AnalyticsRepository, UPCOMING_WINDOW, ATTENTION_WINDOW };
