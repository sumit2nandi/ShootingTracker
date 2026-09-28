'use strict';

/**
 * Distinct values used to populate the filter bar — scoped to one account's
 * data, so the filters only offer what the account being viewed has.
 */
class MetadataRepository {
  /** @param {{ database: import('../persistence/postgres-database').Database }} deps */
  constructor({ database }) {
    this.database = database;
  }

  async distinctClients(ownerId) {
    const result = await this.database.query(
      `SELECT DISTINCT lower(client_name) AS client FROM shoots
       WHERE owner_id = $1 AND client_name IS NOT NULL AND trim(client_name) <> '' ORDER BY 1`,
      [ownerId]
    );
    return result.rows.map((row) => row.client);
  }

  async distinctTypes(ownerId) {
    const result = await this.database.query(
      `SELECT DISTINCT lower(shoot_type) AS type FROM shoots
       WHERE owner_id = $1 AND shoot_type IS NOT NULL AND trim(shoot_type) <> '' ORDER BY 1`,
      [ownerId]
    );
    return result.rows.map((row) => row.type);
  }

  async months(ownerId) {
    const result = await this.database.query(
      'SELECT to_char(shoot_date, \'YYYY-MM\') AS ym FROM shoots WHERE owner_id = $1 GROUP BY 1 ORDER BY 1 DESC',
      [ownerId]
    );
    return result.rows.map((row) => row.ym);
  }
}

module.exports = { MetadataRepository };
