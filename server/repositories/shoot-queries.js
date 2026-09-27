'use strict';

/**
 * SQL shared by every query that reads shoots.
 *
 * `base` decorates each shoot with its coordinator name, the sum of its
 * payments and the derived payment status, so list, detail, filtering and the
 * dashboard all see exactly the same computed columns — one definition, no
 * drift.
 */
const BASE_CTE = `
WITH base AS (
  SELECT s.*,
         c.name AS coordinator,
         COALESCE(p.sum_paid, 0)::numeric AS paid_amount,
         CASE
           WHEN s.fee > 0 AND COALESCE(p.sum_paid,0) >= s.fee THEN 'paid'
           WHEN COALESCE(p.sum_paid,0) > 0 THEN 'partial'
           ELSE 'unpaid'
         END AS payment_status
  FROM shoots s
  LEFT JOIN coordinators c ON c.id = s.coordinator_id
  LEFT JOIN (SELECT shoot_id, SUM(amount) AS sum_paid FROM payments GROUP BY shoot_id) p
         ON p.shoot_id = s.id
)`;

/** The projection returned by the shoots endpoints. */
const SHOOT_COLUMNS = `b.id, b.title, b.client_name, b.shoot_type, b.shoot_date, b.end_date,
       b.start_time, b.end_time, b.venue, b.location, b.coordinator_id,
       b.coordinator, b.fee, b.paid_amount, b.payment_status, b.status,
       b.contact_name, b.contact_phone, b.notes, b.extra, b.created_at, b.updated_at`;

module.exports = { BASE_CTE, SHOOT_COLUMNS };
