'use strict';

const express = require('express');
const { asyncHandler } = require('../../core/async-handler');
const { parseId } = require('../../domain/identifier');

/**
 * `/api/shoots` — CRUD.
 *
 * Handlers do three things only: read the request, call one service method
 * (with the request's data scope) and choose a status code. No SQL, no
 * business rules, no error formatting.
 *
 * @param {{ shootService: import('../../services/shoot-service').ShootService }} deps
 */
function createShootRouter({ shootService }) {
  const router = express.Router();

  router.get(
    '/shoots',
    asyncHandler(async (req, res) => {
      res.json(await shootService.list(req.query, req.scope));
    })
  );

  router.get(
    '/shoots/:id',
    asyncHandler(async (req, res) => {
      res.json(await shootService.getDetail(parseId(req.params.id, 'shoot id'), req.scope));
    })
  );

  router.post(
    '/shoots',
    asyncHandler(async (req, res) => {
      res.status(201).json(await shootService.create(req.body || {}, req.scope));
    })
  );

  router.put(
    '/shoots/:id',
    asyncHandler(async (req, res) => {
      await shootService.update(parseId(req.params.id, 'shoot id'), req.body || {}, req.scope);
      res.json({ ok: true });
    })
  );

  router.delete(
    '/shoots/:id',
    asyncHandler(async (req, res) => {
      await shootService.remove(parseId(req.params.id, 'shoot id'), req.scope);
      res.json({ ok: true });
    })
  );

  return router;
}

module.exports = { createShootRouter };
