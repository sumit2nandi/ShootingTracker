'use strict';

const { NotFoundError, ValidationError } = require('../core/errors');

/** Use cases for photo / album / drive links attached to a shoot. */
class MediaService {
  /**
   * @param {{ mediaRepository: import('../repositories/media-repository').MediaRepository,
   *           shootRepository: import('../repositories/shoot-repository').ShootRepository }} deps
   */
  constructor({ mediaRepository, shootRepository }) {
    this.mediaRepository = mediaRepository;
    this.shootRepository = shootRepository;
  }

  /**
   * @param {number} shootId
   * @param {{ file_url?: string, caption?: string }} body
   * @returns {Promise<{ id: number }>}
   */
  async attach(shootId, body = {}) {
    const fileUrl = typeof body.file_url === 'string' ? body.file_url.trim() : '';
    if (!fileUrl) throw new ValidationError('file_url required');
    if (!(await this.shootRepository.existsById(shootId))) throw new NotFoundError();

    const id = await this.mediaRepository.insert({
      shoot_id: shootId,
      file_url: fileUrl,
      caption: body.caption || null
    });
    return { id };
  }

  /** @throws {NotFoundError} when the media link does not exist */
  async remove(mediaId) {
    const deleted = await this.mediaRepository.deleteById(mediaId);
    if (!deleted) throw new NotFoundError();
  }
}

module.exports = { MediaService };
