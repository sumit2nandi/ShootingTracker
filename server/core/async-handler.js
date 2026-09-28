'use strict';

/**
 * Wrap an async Express handler so a rejected promise reaches `next(err)`.
 *
 * Express 4 does not await handlers: every route used to repeat
 * `try { … } catch (e) { next(e); }`. One wrapper removes that duplication and
 * guarantees no route can silently swallow a rejection.
 *
 * @param {(req: import('express').Request, res: import('express').Response, next: Function) => Promise<unknown>} handler
 * @returns {import('express').RequestHandler}
 */
function asyncHandler(handler) {
  return function wrapped(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

module.exports = { asyncHandler };
