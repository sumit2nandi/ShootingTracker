'use strict';

const express = require('express');
const { asyncHandler } = require('../../core/async-handler');
const { parseId } = require('../../domain/identifier');

/**
 * The earnings ledger: `POST /api/shoots/:id/payments`, `DELETE /api/payments/:id`.
 *
 * @param {{ paymentService: import('../../services/payment-service').PaymentService }} deps
 */
function createPaymentRouter({ paymentService }) {
  const router = express.Router();

  router.post(
    '/shoots/:id/payments',
    asyncHandler(async (req, res) => {
      const shootId = parseId(req.params.id, 'shoot id');
      res.status(201).json(await paymentService.record(shootId, req.body || {}));
    })
  );

  router.delete(
    '/payments/:id',
    asyncHandler(async (req, res) => {
      await paymentService.remove(parseId(req.params.id, 'payment id'));
      res.json({ ok: true });
    })
  );

  return router;
}

module.exports = { createPaymentRouter };
