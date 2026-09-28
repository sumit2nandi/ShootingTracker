'use strict';

const express = require('express');
const { asyncHandler } = require('../../core/async-handler');
const { parseId } = require('../../domain/identifier');

/**
 * Media links: `POST /api/shoots/:id/media`, `DELETE /api/media/:id`.
 *
 * @param {{ mediaService: import('../../services/media-service').MediaService }} deps
 */
function createMediaRouter({ mediaService }) {
  const router = express.Router();

  router.post(
    '/shoots/:id/media',
    asyncHandler(async (req, res) => {
      const shootId = parseId(req.params.id, 'shoot id');
      res.status(201).json(await mediaService.attach(shootId, req.body || {}, req.scope));
    })
  );

  router.delete(
    '/media/:id',
    asyncHandler(async (req, res) => {
      await mediaService.remove(parseId(req.params.id, 'media id'), req.scope);
      res.json({ ok: true });
    })
  );

  return router;
}

module.exports = { createMediaRouter };
