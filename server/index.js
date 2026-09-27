'use strict';
const path = require('path');
const express = require('express');
const { pool, query, checkHealth } = require('./db');
const { parseSheet, detectFormat } = require('./parse');
const { importRows } = require('./import-core');

const app = express();
const PORT = process.env.PORT || 3000;
app.disable('x-powered-by');
app.use(express.json({ limit: '15mb' }));
app.use(express.text({ limit: '15mb', type: ['text/*', 'application/*'] }));
app.use(express.static(path.join(__dirname, '..', 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache, must-revalidate')
}));

const STATUSES = ['planned', 'confirmed', 'completed', 'postponed', 'cancelled'];

/* ---------------- filters ---------------- */

function buildFilter(clauseAlias = 'b') {
  const conds = [];
  const params = [];
  // `values` may be a single value or an array (one per `?` placeholder)
  const add = (sql, values) => {
    const vals = Array.isArray(values) ? values : [values];
    let i = 0;
    conds.push(sql.replace(/\?/g, () => {
      params.push(vals[i++]);
      return `$${params.length}`;
    }));
  };

  const q = (q) => (q && String(q).trim() ? String(q).trim() : null);

  if (q(this.year)) {
    const y = String(this.year);
    if (/^\d{4}$/.test(y)) add(`${clauseAlias}.shoot_date >= ?::date AND ${clauseAlias}.shoot_date < (?::date + interval '1 year')`, [`${y}-01-01`, `${y}-01-01`]);
  }
  if (q(this.month)) {
    // month = 'YYYY-MM'
    const m = String(this.month);
    if (/^\d{4}-\d{2}$/.test(m)) add(`${clauseAlias}.shoot_date >= ?::date AND ${clauseAlias}.shoot_date < (?::date + interval '1 month')`, [`${m}-01`, `${m}-01`]);
  }
  if (q(this.from)) add(`${clauseAlias}.shoot_date >= ?::date`, this.from);
  if (q(this.to)) add(`${clauseAlias}.shoot_date <= ?::date`, this.to);
  if (q(this.coordinator)) {
    const c = String(this.coordinator);
    if (/^\d+$/.test(c)) add(`${clauseAlias}.coordinator_id = ?::int`, c);
    else add(`lower(coordinator) = lower(?)`, c);
  }
  if (q(this.client)) add(`lower(${clauseAlias}.client_name) = lower(?)`, this.client);
  if (q(this.status)) {
    const s = String(this.status).split(',').map((x) => x.trim()).filter((x) => STATUSES.includes(x));
    if (s.length) add(`${clauseAlias}.status = ANY(?)`, [s]); // single array parameter
  }
  if (q(this.type)) add(`lower(${clauseAlias}.shoot_type) = lower(?)`, this.type);
  if (q(this.q)) add(`(${clauseAlias}.title ILIKE ? OR ${clauseAlias}.client_name ILIKE ? OR ${clauseAlias}.venue ILIKE ? OR ${clauseAlias}.location ILIKE ? OR ${clauseAlias}.notes ILIKE ? OR ${clauseAlias}.extra::text ILIKE ?)`,
    [`%${this.q}%`, `%${this.q}%`, `%${this.q}%`, `%${this.q}%`, `%${this.q}%`, `%${this.q}%`]);
  if (q(this.minFee)) add(`${clauseAlias}.fee >= ?::numeric`, this.minFee);
  if (q(this.maxFee)) add(`${clauseAlias}.fee <= ?::numeric`, this.maxFee);
  if (q(this.paymentStatus)) {
    if (this.paymentStatus === 'paid') add(`(${clauseAlias}.fee > 0 AND ${clauseAlias}.paid_amount >= ${clauseAlias}.fee)`, null);
    if (this.paymentStatus === 'partial') add(`(${clauseAlias}.paid_amount > 0 AND ${clauseAlias}.paid_amount < ${clauseAlias}.fee)`, null);
    if (this.paymentStatus === 'unpaid') add(`(${clauseAlias}.paid_amount = 0)`, null);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  return { where, params };
}

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

/* ---------------- meta / dashboard ---------------- */

app.get('/api/health', async (_req, res) => {
  const h = await checkHealth();
  res.json({ ok: h.ok, detail: h.detail, latencyMs: h.latencyMs, time: new Date().toISOString() });
});

app.get('/api/meta', async (_req, res, next) => {
  try {
    const [coordinators, clients, types, months] = await Promise.all([
      query('SELECT id, name FROM coordinators ORDER BY lower(name)'),
      query(`SELECT DISTINCT lower(client_name) AS client FROM shoots
             WHERE client_name IS NOT NULL AND trim(client_name) <> '' ORDER BY 1`),
      query(`SELECT DISTINCT lower(shoot_type) AS type FROM shoots
             WHERE shoot_type IS NOT NULL AND trim(shoot_type) <> '' ORDER BY 1`),
      query(`SELECT to_char(shoot_date, 'YYYY-MM') AS ym FROM shoots GROUP BY 1 ORDER BY 1 DESC`)
    ]);
    res.json({
      statuses: STATUSES,
      coordinators: coordinators.rows,
      clients: clients.rows.map((r) => r.client),
      types: types.rows.map((r) => r.type),
      months: months.rows.map((r) => r.ym)
    });
  } catch (e) { next(e); }
});

app.get('/api/dashboard', async (req, res, next) => {
  try {
    const f = buildFilter.call(req.query);
    const { where, params } = f;

    const kpi = await query(BASE_CTE + `
      SELECT COUNT(*)::int AS shoots,
             COALESCE(SUM(fee),0)::numeric AS total_fee,
             COALESCE(SUM(paid_amount),0)::numeric AS total_paid,
             COALESCE(SUM(fee - LEAST(paid_amount, fee)),0)::numeric AS outstanding,
             COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
             COUNT(*) FILTER (WHERE status IN ('planned','confirmed'))::int AS active,
             COUNT(*) FILTER (WHERE payment_status = 'paid')::int AS paidShoots,
             COUNT(*) FILTER (WHERE payment_status = 'unpaid')::int AS unpaidShoots
      FROM base b ${where}`, params);

    const monthly = await query(BASE_CTE + `
      SELECT to_char(shoot_date, 'YYYY-MM') AS ym,
             COUNT(*)::int AS shoots,
             COALESCE(SUM(fee),0)::numeric AS fee,
             COALESCE(SUM(paid_amount),0)::numeric AS paid
      ${where ? `FROM base b ${where}` : 'FROM base b'}
      GROUP BY 1 ORDER BY 1 DESC LIMIT 36`, params);

    const byCoordinator = await query(BASE_CTE + `
      SELECT COALESCE(NULLIF(coordinator,''), 'Unassigned') AS name,
             COUNT(*)::int AS shoots,
             COALESCE(SUM(fee),0)::numeric AS fee,
             COALESCE(SUM(paid_amount),0)::numeric AS paid
      ${where ? `FROM base b ${where}` : 'FROM base b'}
      GROUP BY 1 ORDER BY fee DESC LIMIT 25`, params);

    const byType = await query(BASE_CTE + `
      SELECT COALESCE(NULLIF(shoot_type,''), 'Other') AS type,
             COUNT(*)::int AS shoots,
             COALESCE(SUM(fee),0)::numeric AS fee
      ${where ? `FROM base b ${where}` : 'FROM base b'}
      GROUP BY 1 ORDER BY shoots DESC LIMIT 25`, params);

    const byStatus = await query(BASE_CTE + `
      SELECT status, COUNT(*)::int AS n
      ${where ? `FROM base b ${where}` : 'FROM base b'}
      GROUP BY 1 ORDER BY n DESC`, params);

    const upcomingExtra = `b.shoot_date >= CURRENT_DATE AND b.status IN ('planned','confirmed')`;
    const upcomingWhere = where ? `${where.replace(/^WHERE\s+/, '')} AND ${upcomingExtra}` : upcomingExtra;
    const upcoming = await query(BASE_CTE + `
      SELECT b.id, b.title, b.client_name, b.shoot_date, b.venue, b.location,
             b.coordinator, b.fee, b.status, b.payment_status
      FROM base b WHERE ${upcomingWhere}
      ORDER BY b.shoot_date ASC LIMIT 8`, params);

    res.json({ kpi: kpi.rows[0], monthly: monthly.rows, byCoordinator: byCoordinator.rows, byType: byType.rows, byStatus: byStatus.rows, upcoming: upcoming.rows });
  } catch (e) { next(e); }
});

/* ---------------- shoots CRUD ---------------- */

const SHOOT_FIELDS = [
  'title', 'client_name', 'shoot_type', 'shoot_date', 'end_date', 'start_time',
  'end_time', 'venue', 'location', 'fee', 'status', 'contact_name',
  'contact_phone', 'notes'
];

function sanitizeShoot(body, partial = false) {
  const out = {};
  for (const f of SHOOT_FIELDS) {
    if (body[f] !== undefined) {
      if (body[f] === null || body[f] === '') out[f] = null;
      else out[f] = body[f];
    } else if (!partial) {
      out[f] = null;
    }
  }
  if (body.coordinator_id !== undefined && body.coordinator !== undefined) {
    // explicit id wins
    out.coordinator_id = body.coordinator_id === null || body.coordinator_id === '' ? null : Number(body.coordinator_id);
  } else if (body.coordinator !== undefined) {
    if (body.coordinator === null || body.coordinator === '') out.coordinator_id = null;
    else if (/^\d+$/.test(String(body.coordinator))) out.coordinator_id = Number(body.coordinator);
    else out.coordinator = String(body.coordinator); // upsert by name in the route
  }
  if (body.extra !== undefined) {
    out.extra = typeof body.extra === 'object' && body.extra !== null ? body.extra : {};
  } else if (!partial) {
    out.extra = {};
  }
  if (out.status && !STATUSES.includes(out.status)) out.status = 'planned';
  if (out.fee !== undefined && out.fee !== null) out.fee = Number(out.fee) || 0;
  if (!partial) {
    // server-side defaults for NOT NULL columns
    if (out.status === null || out.status === undefined) out.status = 'planned';
    if (out.fee === null || out.fee === undefined) out.fee = 0;
    if (out.extra === null || out.extra === undefined) out.extra = {};
  }
  return out;
}

async function upsertCoordinatorByName(client, name) {
  if (!name) return null;
  const ins = await client.query(
    'INSERT INTO coordinators (name) VALUES ($1) ON CONFLICT (lower(name)) DO UPDATE SET name = EXCLUDED.name RETURNING id',
    [name.trim()]
  );
  return ins.rows[0].id;
}

app.get('/api/shoots', async (req, res, next) => {
  try {
    const f = buildFilter.call(req.query);
    const { where, params } = f;
    const r = await query(BASE_CTE + `
      SELECT b.id, b.title, b.client_name, b.shoot_type, b.shoot_date, b.end_date,
             b.start_time, b.end_time, b.venue, b.location, b.coordinator_id,
             b.coordinator, b.fee, b.paid_amount, b.payment_status, b.status,
             b.contact_name, b.contact_phone, b.notes, b.extra, b.created_at, b.updated_at
      ${where ? `FROM base b ${where}` : 'FROM base b'}
      ORDER BY b.shoot_date DESC, b.id DESC
      LIMIT 2000`, params);
    res.json(r.rows);
  } catch (e) { next(e); }
});

app.get('/api/shoots/:id', async (req, res, next) => {
  try {
    const s = await query(BASE_CTE + `
      SELECT b.id, b.title, b.client_name, b.shoot_type, b.shoot_date, b.end_date,
             b.start_time, b.end_time, b.venue, b.location, b.coordinator_id,
             b.coordinator, b.fee, b.paid_amount, b.payment_status, b.status,
             b.contact_name, b.contact_phone, b.notes, b.extra, b.created_at, b.updated_at
      FROM base b WHERE b.id = $1`, [req.params.id]);
    if (!s.rows.length) return res.status(404).json({ error: 'not found' });
    const [payments, media] = await Promise.all([
      query('SELECT * FROM payments WHERE shoot_id = $1 ORDER BY paid_on DESC, id DESC', [req.params.id]),
      query('SELECT * FROM media WHERE shoot_id = $1 ORDER BY id', [req.params.id])
    ]);
    res.json({ ...s.rows[0], payments: payments.rows, media: media.rows });
  } catch (e) { next(e); }
});

app.post('/api/shoots', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const shoot = sanitizeShoot(req.body || {});
    if (!shoot.title || !shoot.shoot_date) {
      return res.status(400).json({ error: 'title and shoot_date are required' });
    }
    await client.query('BEGIN');
    if (shoot.coordinator) {
      shoot.coordinator_id = await upsertCoordinatorByName(client, shoot.coordinator);
      delete shoot.coordinator;
    }
    const cols = Object.keys(shoot);
    const vals = Object.values(shoot);
    const r = await client.query(
      `INSERT INTO shoots (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`,
      vals
    );
    await client.query('COMMIT');
    res.status(201).json({ id: r.rows[0].id });
  } catch (e) {
    await client.query('ROLLBACK');
    next(e);
  } finally {
    client.release();
  }
});

app.put('/api/shoots/:id', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const shoot = sanitizeShoot(req.body || {}, true);
    if (!Object.keys(shoot).length) return res.status(400).json({ error: 'no fields to update' });
    await client.query('BEGIN');
    if (shoot.coordinator !== undefined) {
      shoot.coordinator_id = shoot.coordinator
        ? await upsertCoordinatorByName(client, shoot.coordinator)
        : null;
      delete shoot.coordinator;
    }
    const sets = Object.keys(shoot).map((k, i) => `${k} = $${i + 1}`).join(', ');
    await client.query(`UPDATE shoots SET ${sets} WHERE id = $${Object.values(shoot).length + 1}`,
      [...Object.values(shoot), req.params.id]);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    next(e);
  } finally {
    client.release();
  }
});

app.delete('/api/shoots/:id', async (req, res, next) => {
  try {
    await query('DELETE FROM shoots WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ---------------- payments ---------------- */

app.post('/api/shoots/:id/payments', async (req, res, next) => {
  try {
    const { amount, paid_on, method, note } = req.body || {};
    if (!amount && amount !== 0) return res.status(400).json({ error: 'amount required' });
    const r = await query(
      'INSERT INTO payments (shoot_id, amount, paid_on, method, note) VALUES ($1,$2, COALESCE($3::date, CURRENT_DATE), $4, $5) RETURNING id',
      [req.params.id, amount, paid_on || null, method || null, note || null]
    );
    res.status(201).json({ id: r.rows[0].id });
  } catch (e) { next(e); }
});

app.delete('/api/payments/:id', async (req, res, next) => {
  try {
    await query('DELETE FROM payments WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ---------------- media ---------------- */

app.post('/api/shoots/:id/media', async (req, res, next) => {
  try {
    const { file_url, caption } = req.body || {};
    if (!file_url) return res.status(400).json({ error: 'file_url required' });
    const r = await query(
      'INSERT INTO media (shoot_id, file_url, caption) VALUES ($1,$2,$3) RETURNING id',
      [req.params.id, file_url, caption || null]
    );
    res.status(201).json({ id: r.rows[0].id });
  } catch (e) { next(e); }
});

app.delete('/api/media/:id', async (req, res, next) => {
  try {
    await query('DELETE FROM media WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ---------------- coordinators ---------------- */

app.post('/api/coordinators', async (req, res, next) => {
  try {
    const { name, email, phone, notes } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name required' });
    const r = await query(
      `INSERT INTO coordinators (name, email, phone, notes)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (lower(name)) DO UPDATE SET
         email = COALESCE(EXCLUDED.email, coordinators.email),
         phone = COALESCE(EXCLUDED.phone, coordinators.phone)
       RETURNING id, name`,
      [name.trim(), email || null, phone || null, notes || null]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) { next(e); }
});

/* ---------------- import ---------------- */

app.post('/api/import', async (req, res, next) => {
  try {
    const body = req.body;
    let text = typeof body === 'string' ? body : (body && (body.content || body.text || body.file));
    if (text === undefined) {
      return res.status(400).json({ error: 'send raw file content as body, or JSON { content, format, dryRun }' });
    }
    if (typeof text !== 'string') text = JSON.stringify(text);
    const format = (body && (body.format || body.type)) || detectFormat(text);
    const rows = parseSheet(text, format);
    const dryRun = body && (body.dryRun === true || body.dryRun === 'true');

    if (dryRun) {
      return res.json({ dryRun: true, format, rows: rows.rows, unmapped: rows.unmapped, problems: rows.problems, count: rows.rows.length });
    }
    const result = await importRows(rows.rows);
    res.json({ dryRun: false, format, ...result, unmapped: rows.unmapped });
  } catch (e) { next(e); }
});

/* ---------------- errors ---------------- */

app.use((err, _req, res, _next) => {
  console.error('[api]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'server error' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`ShootingTracker listening on http://0.0.0.0:${PORT}`);
});
