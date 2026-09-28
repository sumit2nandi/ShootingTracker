'use strict';

const { withTranslatedErrors } = require('../persistence/pg-error-translator');

/** SQL for photo / album / drive links attached to a shoot. */
class MediaRepository {
  /** @param {{ database: import('../persistence/postgres-database').Database }} deps */
  constructor({ database }) {
    this.database = database;
  }

  async listByShoot(shootId) {
    const result = await this.database.query('SELECT * FROM media WHERE shoot_id = $1 ORDER BY id', [shootId]);
    return result.rows;
  }

  /**
   * @param {{ shoot_id: number, file_url: string, caption?: string|null }} media
   * @returns {Promise<number>} the new media id
   */
  async insert(media) {
    const result = await withTranslatedErrors(() =>
      this.database.query(
        'INSERT INTO media (shoot_id, file_url, caption) VALUES ($1,$2,$3) RETURNING id',
        [media.shoot_id, media.file_url, media.caption || null]
      )
    );
    return result.rows[0].id;
  }

  /**
   * The `owner_id` of the shoot a media link belongs to.
   *
   * @returns {Promise<number|null>} null when the link does not exist
   */
  async ownerOfMedia(id) {
    const result = await this.database.query(
      'SELECT s.owner_id FROM media m JOIN shoots s ON s.id = m.shoot_id WHERE m.id = $1',
      [id]
    );
    return result.rows.length ? result.rows[0].owner_id : null;
  }

  /** @returns {Promise<boolean>} whether a row was deleted */
  async deleteById(id) {
    const result = await this.database.query('DELETE FROM media WHERE id = $1', [id]);
    return result.rowCount > 0;
  }
}

module.exports = { MediaRepository };
