'use strict';

const express = require('express');
const { asyncHandler } = require('../../core/async-handler');
const { parseId } = require('../../domain/identifier');

/**
 * `/api/coordinators` — upsert by name, delete when unused.
 *
 * @param {{ coordinatorService: import('../../services/coordinator-service').CoordinatorService }} deps
 */
function createCoordinatorRouter({ coordinatorService }) {
  const router = express.Router();

  router.post(
    '/coordinators',
    asyncHandler(async (req, res) => {
      res.status(201).json(await coordinatorService.upsert(req.body || {}));
    })
  );

  router.delete(
    '/coordinators/:id',
    asyncHandler(async (req, res) => {
      const deleted = await coordinatorService.remove(parseId(req.params.id, 'coordinator id'));
      res.json({ ok: true, deleted });
    })
  );

  return router;
}

module.exports = { createCoordinatorRouter };
