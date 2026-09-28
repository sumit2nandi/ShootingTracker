'use strict';

const { asyncHandler } = require('../../core/async-handler');

/**
 * Resolves the data scope for every authenticated request, once.
 *
 * Handlers never interpret `viewingAs` themselves; they hand `req.scope` to
 * their service and the scoping rule lives in exactly one place
 * ({@link import('../../services/data-scope-service').DataScopeService}).
 *
 * @param {{ dataScopeService: import('../../services/data-scope-service').DataScopeService }} deps
 */
function createDataScopeMiddleware({ dataScopeService }) {
  return asyncHandler(async (req, _res, next) => {
    req.scope = await dataScopeService.resolve(req.user, req.query && req.query.viewingAs);
    next();
  });
}

module.exports = { createDataScopeMiddleware };
