'use strict';
// Who may sign in to ShootingTracker.
//
// The allow-list used to be a hard-coded array in auth.js. It now lives in the
// `app_users` table (see schema.sql) so it can be managed from the database or
// from the app's "People with access" screen without touching code.
const fs = require('fs');
const path = require('path');
const { query } = require('./db');

const CACHE_MS = 20000;      // allow-list lookups are cached briefly so page loads stay cheap
let cache = { at: 0, byEmail: new Map() };
let ready = null;

function invalidate() { cache = { at: 0, byEmail: new Map() }; }

function normEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/**
 * Make sure app_users exists. The schema is fully idempotent, so on a database
 * that has not been migrated yet we simply apply schema.sql once — that keeps a
 * fresh install from locking everyone out.
 */
function ensureUsersTable() {
  if (!ready) {
    ready = (async () => {
      const r = await query("SELECT to_regclass('public.app_users') AS t");
      if (!r.rows[0].t) {
        const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
        await query(sql);
        console.log('[auth] app_users was missing — applied schema.sql');
      }
    })().catch((e) => { ready = null; throw e; });   // retry on the next call
  }
  return ready;
}

/** Active user row for an email (cached), or null when unknown/deactivated. */
async function lookupUser(email) {
  const key = normEmail(email);
  if (!key) return null;
  await ensureUsersTable();
  if (Date.now() - cache.at < CACHE_MS && cache.byEmail.has(key)) {
    return cache.byEmail.get(key);
  }
  const r = await query(
    'SELECT id, email, name, role, is_active FROM app_users WHERE lower(email) = $1', [key]);
  const row = r.rows[0] || null;
  cache = { at: Date.now(), byEmail: cache.byEmail.set(key, row) };
  return row;
}

/** True when the email may sign in (active row only). */
async function isAllowedEmail(email) {
  const row = await lookupUser(email);
  return !!(row && row.is_active);
}

async function listUsers() {
  await ensureUsersTable();
  const r = await query(
    `SELECT id, email, name, role, is_active, created_at
       FROM app_users ORDER BY is_active DESC, lower(email)`);
  return r.rows;
}

async function addUser({ email, name, role }) {
  await ensureUsersTable();
  const r = await query(
    `INSERT INTO app_users (email, name, role)
     VALUES ($1, $2, COALESCE($3, 'member'))
     ON CONFLICT (lower(email)) DO UPDATE
       SET name = COALESCE(EXCLUDED.name, app_users.name),
           role = COALESCE($3, app_users.role),
           is_active = TRUE
     RETURNING id, email, name, role, is_active`,
    [normEmail(email), (name && String(name).trim()) || null, role === 'owner' ? 'owner' : 'member']);
  invalidate();
  return r.rows[0];
}

async function updateUser(id, patch = {}) {
  await ensureUsersTable();
  const sets = [];
  const params = [];
  const add = (sql, value) => { params.push(value); sets.push(sql.replace('?', `$${params.length}`)); };
  if (patch.name !== undefined) add('name = ?', (patch.name && String(patch.name).trim()) || null);
  if (patch.role !== undefined) add('role = ?', patch.role === 'owner' ? 'owner' : 'member');
  if (patch.is_active !== undefined) add('is_active = ?', !!patch.is_active);
  if (!sets.length) return null;
  params.push(Number(id));
  const r = await query(
    `UPDATE app_users SET ${sets.join(', ')} WHERE id = $${params.length}
     RETURNING id, email, name, role, is_active`, params);
  invalidate();
  return r.rows[0] || null;
}

async function removeUser(id) {
  await ensureUsersTable();
  const r = await query('DELETE FROM app_users WHERE id = $1 RETURNING id, email', [Number(id)]);
  invalidate();
  return r.rows[0] || null;
}

/** Owner emails, used to guard the access-management endpoints. */
async function isOwner(email) {
  const row = await lookupUser(email);
  return !!(row && row.is_active && row.role === 'owner');
}

module.exports = {
  ensureUsersTable, lookupUser, isAllowedEmail, isOwner,
  listUsers, addUser, updateUser, removeUser, invalidate
};
