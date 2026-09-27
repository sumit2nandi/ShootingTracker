'use strict';

/** Distinct values used to populate the filter bar. */
class MetadataRepository {
  /** @param {{ database: import('../persistence/postgres-database').Database }} deps */
  constructor({ database }) {
    this.database = database;
  }

  async distinctClients() {
    const result = await this.database.query(
      `SELECT DISTINCT lower(client_name) AS client FROM shoots
       WHERE client_name IS NOT NULL AND trim(client_name) <> '' ORDER BY 1`
    );
    return result.rows.map((row) => row.client);
  }

  async distinctTypes() {
    const result = await this.database.query(
      `SELECT DISTINCT lower(shoot_type) AS type FROM shoots
       WHERE shoot_type IS NOT NULL AND trim(shoot_type) <> '' ORDER BY 1`
    );
    return result.rows.map((row) => row.type);
  }

  async months() {
    const result = await this.database.query(
      `SELECT to_char(shoot_date, 'YYYY-MM') AS ym FROM shoots GROUP BY 1 ORDER BY 1 DESC`
    );
    return result.rows.map((row) => row.ym);
  }
}

module.exports = { MetadataRepository };
