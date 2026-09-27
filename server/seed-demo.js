'use strict';
// Seeds clearly-marked demo rows so the UI can be exercised before real
// data is imported. Deletes other demo rows first (idempotent).
const crypto = require('crypto');
const { pool } = require('./db');

const COORDS = ['Riya Saha', 'Arjun Mukherjee', 'Priyanka Dutta', 'Sameer Khan'];
const CLIENTS = [
  'Ananya & Vikram', 'Rohit Industries', 'Debojit & Shreya', 'Meera Kapoor',
  'Sanket Jewellers', 'Ishita & Arindam', 'Nova Boutique', 'Tuhin Banerjee',
  'Lakshmi Sarees', 'Kunal & Ritu', 'Vishal Realty', 'Ariya Chakraborty'
];
const TYPES = ['wedding', 'pre-wedding', 'fashion', 'commercial', 'maternity', 'newborn', 'product'];
const VENUES = ['Sambad Pavilion, Kolkata', 'The Grand Ballroom, Howrah', 'Studio 8, Salt Lake', 'Nalhati Resort, Murshidabad', 'Skyline Rooftop, BKC', 'Botanical Garden, Shibpur'];
const LOCATIONS = ['Kolkata', 'Howrah', 'Kharagpur', 'Darjeeling', 'Murshidabad'];
const STATUSES = ['planned', 'completed', 'completed', 'completed', 'planned'];

const D = (s) => s; // passthrough for clarity

function buildRows() {
  const rows = [];
  const now = new Date();
  // spread across last 8 months + next 3 months
  const months = [];
  for (let off = -8; off <= 3; off++) {
    const d = new Date(now.getFullYear(), now.getMonth() + off, 1);
    months.push({ y: d.getFullYear(), m: d.getMonth() });
  }
  let id = 0;
  for (const { y, m } of months) {
    const count = 3 + Math.floor(Math.random() * 5);
    for (let i = 0; i < count; i++) {
      id++;
      const type = TYPES[Math.floor(Math.random() * TYPES.length)];
      const client = CLIENTS[Math.floor(Math.random() * CLIENTS.length)];
      const coord = COORDS[Math.floor(Math.random() * COORDS.length)];
      const day = 1 + Math.floor(Math.random() * 27);
      const date = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const fee = [5000, 8000, 12000, 15000, 20000, 25000, 35000, 45000][Math.floor(Math.random() * 8)];
      const isFuture = new Date(date) > now;
      const status = isFuture ? 'planned' : STATUSES[Math.floor(Math.random() * STATUSES.length)];
      const title = `[DEMO] ${type.charAt(0).toUpperCase() + type.slice(1)} shoot`;
      const dedupe = crypto.createHash('md5').update(`demo|${title}|${date}|${client}`).digest('hex');
      const paid = !isFuture ? (Math.random() < 0.8 ? fee : fee / 2) : 0;
      rows.push({
        title, client_name: client, shoot_type: type, shoot_date: date,
        end_date: null, start_time: '10:00:00', end_time: null,
        venue: VENUES[Math.floor(Math.random() * VENUES.length)],
        location: LOCATIONS[Math.floor(Math.random() * LOCATIONS.length)],
        coordinator: coord, fee, status,
        contact_name: client.split(' ')[0],
        contact_phone: `+91 9${String(Math.floor(Math.random() * 900000000) + 100000000)}`,
        notes: 'Demo row — replace with your imported data.',
        payments: paid ? [{ amount: paid, method: Math.random() < 0.5 ? 'cash' : 'UPI', note: 'demo seed', paid_on: date }] : [],
        extra: {}, dedupe_hash: dedupe
      });
    }
  }
  return rows;
}

(async () => {
  const rows = buildRows();
  await pool.query(`DELETE FROM shoots WHERE title LIKE '[DEMO]%'`);
  let inserted = 0, payments = 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const row of rows) {
      const coord = await client.query(
        `INSERT INTO coordinators (name) VALUES ($1) ON CONFLICT (lower(name)) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
        [row.coordinator]
      );
      const res = await client.query(
        `INSERT INTO shoots (title, client_name, shoot_type, shoot_date, end_date, start_time, end_time,
                             venue, location, coordinator_id, fee, status, contact_name, contact_phone,
                             notes, extra, dedupe_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'{}'::jsonb,$16)
         ON CONFLICT (dedupe_hash) DO NOTHING RETURNING id`,
        [row.title, row.client_name, row.shoot_type, row.shoot_date, row.end_date, row.start_time, row.end_time,
         row.venue, row.location, coord.rows[0].id, row.fee, row.status, row.contact_name, row.contact_phone,
         row.notes, row.dedupe_hash]
      );
      if (!res.rows.length) continue;
      inserted++;
      const sid = res.rows[0].id;
      for (const p of row.payments) {
        await client.query(
          'INSERT INTO payments (shoot_id, amount, paid_on, method, note) VALUES ($1,$2,COALESCE($3::date,CURRENT_DATE),$4,$5)',
          [sid, p.amount, p.paid_on, p.method, p.note]
        );
        payments++;
      }
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  console.log(`Demo seed: ${inserted} shoots, ${payments} payments.`);
  await pool.end();
})().catch((e) => {
  console.error('Seed failed:', e.message);
  process.exit(1);
});
