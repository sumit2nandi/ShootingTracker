'use strict';

const { NotFoundError, ValidationError } = require('../core/errors');

/**
 * Use cases for photo / album / drive links attached to a shoot.
 *
 * Like the ledger, links are scoped through their shoot: only the owner of a
 * shoot can attach to it or remove its links.
 */
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
   * @param {import('../domain/data-scope').DataScope} scope
   * @returns {Promise<{ id: number }>}
   */
  async attach(shootId, body = {}, scope) {
    const fileUrl = typeof body.file_url === 'string' ? body.file_url.trim() : '';
    if (!fileUrl) throw new ValidationError('file_url required');
    const shoot = await this.shootRepository.findById(shootId);
    if (!shoot || shoot.owner_id !== scope.selfId) throw new NotFoundError();

    const id = await this.mediaRepository.insert({
      shoot_id: shootId,
      file_url: fileUrl,
      caption: body.caption || null
    });
    return { id };
  }

  /** @throws {NotFoundError} when the media link does not exist or is not the caller's */
  async remove(mediaId, scope) {
    const owner = await this.mediaRepository.ownerOfMedia(mediaId);
    if (owner !== scope.selfId) throw new NotFoundError();
    const deleted = await this.mediaRepository.deleteById(mediaId);
    if (!deleted) throw new NotFoundError();
  }
}

module.exports = { MediaService };
