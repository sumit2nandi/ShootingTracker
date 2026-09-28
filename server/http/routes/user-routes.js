'use strict';

const express = require('express');
const { asyncHandler } = require('../../core/async-handler');

/**
 * `/api/users` — the allow-list, owner-only.
 *
 * Authorization is one `requireOwner` guard on the router instead of a repeated
 * check in four handlers.
 *
 * @param {{ accessService: import('../../services/access-service').AccessService,
 *           requireOwner: import('express').RequestHandler }} deps
 */
function createUserRouter({ accessService, requireOwner }) {
  const router = express.Router();
  router.use('/users', requireOwner);

  router.get(
    '/users',
    asyncHandler(async (_req, res) => {
      res.json({ users: await accessService.list() });
    })
  );

  router.post(
    '/users',
    asyncHandler(async (req, res) => {
      res.status(201).json({ user: await accessService.add(req.body || {}) });
    })
  );

  router.patch(
    '/users/:id',
    asyncHandler(async (req, res) => {
      const user = await accessService.update(req.params.id, req.body || {}, { actor: req.user });
      res.json({ user });
    })
  );

  router.delete(
    '/users/:id',
    asyncHandler(async (req, res) => {
      const removed = await accessService.remove(req.params.id, { actor: req.user });
      res.json({ removed });
    })
  );

  return router;
}

module.exports = { createUserRouter };
