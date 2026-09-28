'use strict';

const { parseStatusList, PAYMENT_STATUS_FILTERS } = require('./shoot-status');

/**
 * Collects SQL fragments and their bind parameters.
 *
 * Fragments are written with `?` placeholders and renumbered to `$1, $2, …`
 * here, so a rule never has to know how many parameters came before it.
 */
class ConditionCollector {
  constructor() {
    this.conditions = [];
    this.params = [];
  }

  /**
   * @param {string} sql fragment using `?` placeholders
   * @param {unknown|unknown[]} [values] one value per placeholder
   */
  add(sql, values) {
    const list = values === undefined ? [] : (Array.isArray(values) ? values : [values]);
    let index = 0;
    this.conditions.push(
      sql.replace(/\?/g, () => {
        this.params.push(list[index++]);
        return `$${this.params.length}`;
      })
    );
    return this;
  }

  get where() {
    return this.conditions.length ? `WHERE ${this.conditions.join(' AND ')}` : '';
  }
}

const trimmed = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
};

/**
 * Filter rules registry.
 *
 * Every supported query parameter is one self-contained entry. Supporting a new
 * filter means appending a rule — the builder itself never changes
 * (open/closed principle).
 *
 * @type {ReadonlyArray<{ param: string, apply: (value: string, ctx: { alias: string, collector: ConditionCollector }) => void }>}
 */
const FILTER_RULES = Object.freeze([
  {
    param: 'year',
    apply(value, { alias, collector }) {
      if (!/^\d{4}$/.test(value)) return;
      collector.add(
        `${alias}.shoot_date >= ?::date AND ${alias}.shoot_date < (?::date + interval '1 year')`,
        [`${value}-01-01`, `${value}-01-01`]
      );
    }
  },
  {
    param: 'month',
    apply(value, { alias, collector }) {
      if (!/^\d{4}-\d{2}$/.test(value)) return;
      collector.add(
        `${alias}.shoot_date >= ?::date AND ${alias}.shoot_date < (?::date + interval '1 month')`,
        [`${value}-01`, `${value}-01`]
      );
    }
  },
  {
    param: 'from',
    apply: (value, { alias, collector }) => collector.add(`${alias}.shoot_date >= ?::date`, value)
  },
  {
    param: 'to',
    apply: (value, { alias, collector }) => collector.add(`${alias}.shoot_date <= ?::date`, value)
  },
  {
    param: 'coordinator',
    apply(value, { alias, collector }) {
      // accepts either a numeric id or a (case-insensitive) name
      if (/^\d+$/.test(value)) collector.add(`${alias}.coordinator_id = ?::int`, value);
      else collector.add(`lower(${alias}.coordinator) = lower(?)`, value);
    }
  },
  {
    param: 'client',
    apply: (value, { alias, collector }) => collector.add(`lower(${alias}.client_name) = lower(?)`, value)
  },
  {
    param: 'status',
    apply(value, { alias, collector }) {
      const statuses = parseStatusList(value);
      if (statuses.length) collector.add(`${alias}.status = ANY(?)`, [statuses]); // one array parameter
    }
  },
  {
    param: 'type',
    apply: (value, { alias, collector }) => collector.add(`lower(${alias}.shoot_type) = lower(?)`, value)
  },
  {
    param: 'q',
    apply(value, { alias, collector }) {
      const pattern = `%${value}%`;
      collector.add(
        `(${alias}.title ILIKE ? OR ${alias}.client_name ILIKE ? OR ${alias}.venue ILIKE ? ` +
          `OR ${alias}.location ILIKE ? OR ${alias}.notes ILIKE ? OR ${alias}.extra::text ILIKE ?)`,
        [pattern, pattern, pattern, pattern, pattern, pattern]
      );
    }
  },
  {
    param: 'minFee',
    apply: (value, { alias, collector }) => collector.add(`${alias}.fee >= ?::numeric`, value)
  },
  {
    param: 'maxFee',
    apply: (value, { alias, collector }) => collector.add(`${alias}.fee <= ?::numeric`, value)
  },
  {
    param: 'paymentStatus',
    apply(value, { alias, collector }) {
      if (!PAYMENT_STATUS_FILTERS.includes(value)) return;
      const predicates = {
        paid: `(${alias}.fee > 0 AND ${alias}.paid_amount >= ${alias}.fee)`,
        partial: `(${alias}.paid_amount > 0 AND ${alias}.paid_amount < ${alias}.fee)`,
        unpaid: `(${alias}.paid_amount = 0)`,
        outstanding: `(${alias}.fee > 0 AND ${alias}.paid_amount < ${alias}.fee)`
      };
      collector.add(predicates[value]);
    }
  },
  {
    // Whose data a read targets — an app_users id, resolved by the caller
    // (the HTTP layer never trusts a raw id from the query string for this).
    param: 'owner',
    apply(value, { alias, collector }) {
      if (!/^\d+$/.test(value)) return;
      collector.add(`${alias}.owner_id = ?::int`, value);
    }
  }
]);

const SUPPORTED_PARAMS = Object.freeze(FILTER_RULES.map((rule) => rule.param));

/**
 * An immutable set of shoot filter criteria that can render itself as SQL.
 *
 * Replaces the previous `buildFilter.call(req.query)`, which smuggled the query
 * string in through `this`: criteria are now an explicit value object that the
 * HTTP layer creates and the repositories consume.
 */
class ShootFilter {
  /** @param {Record<string, string>} [criteria] */
  constructor(criteria = {}) {
    this.criteria = Object.freeze({ ...criteria });
  }

  /** Build from an Express-style query object, ignoring unknown parameters. */
  static fromQuery(query = {}) {
    const criteria = {};
    for (const param of SUPPORTED_PARAMS) {
      const value = trimmed(query[param]);
      if (value !== null) criteria[param] = value;
    }
    return new ShootFilter(criteria);
  }

  static empty() {
    return new ShootFilter({});
  }

  get isEmpty() {
    return Object.keys(this.criteria).length === 0;
  }

  /**
   * Render a WHERE clause.
   *
   * @param {{ alias?: string, extraConditions?: string[] }} [options]
   *        `extraConditions` are parameter-free SQL predicates ANDed to the
   *        result (used by the dashboard's "next 7 days" widget instead of
   *        string-surgery on an already built clause).
   * @returns {{ where: string, params: unknown[] }}
   */
  toSql({ alias = 'b', extraConditions = [] } = {}) {
    const collector = new ConditionCollector();
    for (const rule of FILTER_RULES) {
      const value = this.criteria[rule.param];
      if (value === undefined) continue;
      rule.apply(value, { alias, collector });
    }
    for (const condition of extraConditions) collector.add(condition);
    return { where: collector.where, params: collector.params };
  }
}

module.exports = { ShootFilter, ConditionCollector, FILTER_RULES, SUPPORTED_PARAMS };
