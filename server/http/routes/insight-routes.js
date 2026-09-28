'use strict';

const express = require('express');
const { asyncHandler } = require('../../core/async-handler');
const { noStore } = require('../middleware/security-headers');

/**
 * Read-only endpoints the UI polls: health, filter metadata and the dashboard.
 *
 * @param {{ healthService: import('../../services/health-service').HealthService,
 *           metadataService: import('../../services/metadata-service').MetadataService,
 *           dashboardService: import('../../services/dashboard-service').DashboardService }} deps
 */
function createInsightRouter({ healthService, metadataService, dashboardService }) {
  const router = express.Router();

  router.get(
    '/health',
    noStore,
    asyncHandler(async (_req, res) => {
      res.json(await healthService.check());
    })
  );

  router.get(
    '/meta',
    asyncHandler(async (req, res) => {
      res.json(await metadataService.describe(req.scope));
    })
  );

  router.get(
    '/dashboard',
    asyncHandler(async (req, res) => {
      res.json(await dashboardService.summarize(req.query, req.scope));
    })
  );

  return router;
}

module.exports = { createInsightRouter };
