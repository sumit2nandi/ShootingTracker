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

  /**
   * The coordinators this account has used in its own shoots — the options
   * its coordinator dropdown should offer (reference data, but *theirs*).
   *
   * @returns {Promise<{ id: number, name: string }[]>}
   */
  async distinctCoordinators(ownerId) {
    const result = await this.database.query(
      `SELECT c.id AS id, c.name AS name
       FROM shoots s
       JOIN coordinators c ON c.id = s.coordinator_id
       WHERE s.owner_id = $1
       GROUP BY c.id, c.name
       ORDER BY lower(c.name)`,
      [ownerId]
    );
    return result.rows;
  }

  /**
   * The account's past shoot titles, most recently touched first — the
   * autocomplete suggestions offered while typing a new title.
   *
   * @returns {Promise<string[]>}
   */
  async pastTitles(ownerId) {
    const result = await this.database.query(
      `SELECT title FROM shoots
       WHERE owner_id = $1 AND title IS NOT NULL AND trim(title) <> ''
       GROUP BY title
       ORDER BY max(updated_at) DESC, lower(title)
       LIMIT 100`,
      [ownerId]
    );
    return result.rows.map((row) => row.title);
  }

  /**
   * The most recent record for each past title, used to prefill amount and
   * coordinator when that title is selected for a new entry.
   *
   * @returns {Promise<{ title: string, fee: number, coordinator: string|null }[]>}
   */
  async titleSuggestions(ownerId) {
    const result = await this.database.query(
      `SELECT title, fee, coordinator
       FROM (
         SELECT DISTINCT ON (lower(s.title)) s.title, s.fee, c.name AS coordinator, s.updated_at
         FROM shoots s
         LEFT JOIN coordinators c ON c.id = s.coordinator_id
         WHERE s.owner_id = $1 AND s.title IS NOT NULL AND trim(s.title) <> ''
         ORDER BY lower(s.title), s.updated_at DESC, s.id DESC
       ) latest
       ORDER BY updated_at DESC, lower(title)
       LIMIT 100`,
      [ownerId]
    );
    return result.rows;
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
