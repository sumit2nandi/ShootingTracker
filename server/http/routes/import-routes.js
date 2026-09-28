'use strict';

const express = require('express');
const { asyncHandler } = require('../../core/async-handler');
const { ImportService } = require('../../services/import-service');

/**
 * `POST /api/import` — parse a sheet, optionally store it.
 *
 * @param {{ importService: ImportService }} deps
 */
function createImportRouter({ importService }) {
  const router = express.Router();

  router.post(
    '/import',
    asyncHandler(async (req, res) => {
      const request = ImportService.readRequest(req.body);
      res.json(await importService.execute(request, req.scope));
    })
  );

  return router;
}

module.exports = { createImportRouter };
