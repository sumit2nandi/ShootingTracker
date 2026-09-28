'use strict';

const express = require('express');
const { createInsightRouter } = require('./insight-routes');
const { createShootRouter } = require('./shoot-routes');
const { createPaymentRouter } = require('./payment-routes');
const { createMediaRouter } = require('./media-routes');
const { createCoordinatorRouter } = require('./coordinator-routes');
const { createImportRouter } = require('./import-routes');
const { createUserRouter } = require('./user-routes');

/**
 * The authenticated half of the API, assembled from one router per resource.
 *
 * Adding a resource means adding a file and one line here; no existing router
 * is touched.
 */
function createApiRouter(deps) {
  const router = express.Router();
  router.use(createInsightRouter(deps));
  router.use(createShootRouter(deps));
  router.use(createPaymentRouter(deps));
  router.use(createMediaRouter(deps));
  router.use(createCoordinatorRouter(deps));
  router.use(createImportRouter(deps));
  router.use(createUserRouter(deps));
  return router;
}

module.exports = { createApiRouter };
