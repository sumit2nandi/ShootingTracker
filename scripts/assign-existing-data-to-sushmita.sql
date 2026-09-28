
-- ============================================================
-- ShootingTracker — one-time migration (paste this whole file
-- into the Aiven web console and run it).
--
--   Part 1: the idempotent schema — creates missing objects and
--           converges a database that predates per-user data
--           (adds app_users.tour_completed and shoots.owner_id).
--   Part 2: hands every unowned shoot to sushmitaghosh0099@gmail.com.
--
-- Equivalent to:  npm run assign:existing
-- Safe to re-run: running it twice changes nothing.
-- ============================================================

-- ============================================================
-- ShootingTracker schema (PostgreSQL)
-- Idempotent: safe to run repeatedly (including in the Aiven
-- web console — just paste this whole file and run).
-- The trailing "convergence" section also upgrades databases
-- created before per-user data existed.
-- ============================================================

-- ---------- coordinators ----------
CREATE TABLE IF NOT EXISTS coordinators (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT,
  phone       TEXT,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS coordinators_name_uq
  ON coordinators (lower(name));

CREATE INDEX IF NOT EXISTS coordinators_name_idx
  ON coordinators (lower(name));

-- ---------- app users (who may sign in) ----------
-- Sign-in is Google-only. Any Google account may sign in: an account that is
-- already in this table signs straight in, and a new one gets a row created
-- (as a member) after it accepts the consent form. Access is managed in the
-- database (or from the app's "People with access" screen) instead of in code.
CREATE TABLE IF NOT EXISTS app_users (
  id          SERIAL PRIMARY KEY,
  email       TEXT NOT NULL,
  name        TEXT,
  role        TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  tour_completed BOOLEAN NOT NULL DEFAULT FALSE,  -- the first-login tour was seen
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS app_users_email_uq ON app_users (lower(email));

-- ---------- shoots ----------
CREATE TABLE IF NOT EXISTS shoots (
  id             SERIAL PRIMARY KEY,
  title          TEXT NOT NULL,
  client_name    TEXT,
  shoot_type     TEXT,                -- wedding, pre-wedding, fashion, commercial, ...
  shoot_date     DATE NOT NULL,
  end_date       DATE,                -- set for multi-day shoots
  start_time     TIME,
  end_time       TIME,
  venue          TEXT,                -- hall / studio name
  location       TEXT,                -- city / area
  coordinator_id INTEGER REFERENCES coordinators(id) ON DELETE SET NULL,
  fee            NUMERIC(14,2) NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'planned'
                 -- only two states: a shoot is either still to come or closed out.
                 -- (existing databases keep their wider CHECK; nothing rewrites rows)
                 CHECK (status IN ('planned','completed')),
  contact_name   TEXT,
  contact_phone  TEXT,
  notes          TEXT,
  owner_id       INTEGER REFERENCES app_users(id) ON DELETE SET NULL,  -- whose data this is
  extra          JSONB NOT NULL DEFAULT '{}'::jsonb,  -- unmapped columns from imports
  dedupe_hash    TEXT,                -- md5 used to keep re-imports idempotent
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT shoots_dates_check CHECK (end_date IS NULL OR end_date >= shoot_date)
);

CREATE UNIQUE INDEX IF NOT EXISTS shoots_dedupe_hash_uq ON shoots (dedupe_hash);
CREATE INDEX IF NOT EXISTS shoots_date_idx      ON shoots (shoot_date);
-- (the owner index is created in the convergence section, where the column
--  is guaranteed to exist on older databases)
CREATE INDEX IF NOT EXISTS shoots_coordinator_idx ON shoots (coordinator_id);
CREATE INDEX IF NOT EXISTS shoots_client_idx    ON shoots (lower(client_name));
CREATE INDEX IF NOT EXISTS shoots_status_idx    ON shoots (status);
CREATE INDEX IF NOT EXISTS shoots_type_idx      ON shoots (lower(shoot_type));
CREATE INDEX IF NOT EXISTS shoots_extra_idx     ON shoots USING gin (extra);

-- ---------- payments (earnings ledger) ----------
CREATE TABLE IF NOT EXISTS payments (
  id         SERIAL PRIMARY KEY,
  shoot_id   INTEGER NOT NULL REFERENCES shoots(id) ON DELETE CASCADE,
  amount     NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  paid_on    DATE NOT NULL DEFAULT CURRENT_DATE,
  method     TEXT,                    -- cash, bank, UPI, ...
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payments_shoot_idx   ON payments (shoot_id);
CREATE INDEX IF NOT EXISTS payments_paid_on_idx ON payments (paid_on);

-- ---------- media (photos / deliverables per shoot) ----------
CREATE TABLE IF NOT EXISTS media (
  id         SERIAL PRIMARY KEY,
  shoot_id   INTEGER NOT NULL REFERENCES shoots(id) ON DELETE CASCADE,
  file_url   TEXT NOT NULL,
  caption    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS media_shoot_idx ON media (shoot_id);

-- ---------- convergence: databases created before per-user data ----------
-- Everything above is skipped on a database that already has the tables;
-- these idempotent statements bring an older database up to the same shape.
ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS tour_completed BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE shoots
  ADD COLUMN IF NOT EXISTS owner_id INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shoots_owner_id_fkey') THEN
    ALTER TABLE shoots
      ADD CONSTRAINT shoots_owner_id_fkey
      FOREIGN KEY (owner_id) REFERENCES app_users(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS shoots_owner_idx ON shoots (owner_id);

-- one-time seed: the accounts that used to be hard-coded in server/auth.js.
-- Safe to re-run; afterwards manage rows in the table (or from the app).
-- tour_completed is TRUE because these are pre-existing accounts, not new
-- sign-ups — the tour is only for accounts created after they first arrive.
-- (After the convergence section, so the column exists on older databases too.)
INSERT INTO app_users (email, name, role, tour_completed) VALUES
  ('sumit2nandi@gmail.com', 'Sumit Nandi', 'owner', TRUE),
  ('sushmitaghosh0099@gmail.com', 'Sushmita Ghosh', 'member', TRUE)
ON CONFLICT (lower(email)) DO NOTHING;

-- ---------- updated_at trigger ----------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS shoots_set_updated_at ON shoots;
CREATE TRIGGER shoots_set_updated_at
  BEFORE UPDATE ON shoots
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- Part 2: give all pre-existing (unowned) shoots to
-- sushmitaghosh0099@gmail.com
-- ============================================================

-- Make sure the account exists. An existing row is left exactly as-is
-- (name, role, active flag untouched); it is only created when missing.
INSERT INTO app_users (email, name, role, tour_completed)
VALUES ('sushmitaghosh0099@gmail.com', 'Sushmita Ghosh', 'member', TRUE)
ON CONFLICT (lower(email)) DO NOTHING;

-- Point every shoot that has no owner yet at the account.
UPDATE shoots
SET owner_id = (SELECT id FROM app_users WHERE lower(email) = 'sushmitaghosh0099@gmail.com')
WHERE owner_id IS NULL;

-- Existing accounts have already "been here" — the first-login tour is only
-- for accounts created from now on.
UPDATE app_users
SET tour_completed = TRUE
WHERE tour_completed = FALSE;

-- (Optional, --all variant) Re-home EVERY shoot, including ones already owned
-- by another account — the three statements above only touch unowned rows.
-- Uncomment and run ONLY if you really want that:
--
-- UPDATE shoots
-- SET owner_id = (SELECT id FROM app_users WHERE lower(email) = 'sushmitaghosh0099@gmail.com');

-- ------------------------------------------------------------
-- Check the result (a result set appears below this query):
--   total shoots, how many are owned by the account, how many unowned.
-- ------------------------------------------------------------
SELECT
  count(*)                                            AS total_shoots,
  count(*) FILTER (WHERE s.owner_id = u.id)           AS owned_by_sushmita,
  count(*) FILTER (WHERE s.owner_id IS NULL)          AS still_unowned,
  count(*) FILTER (WHERE s.owner_id IS NOT NULL
                    AND s.owner_id <> u.id)           AS owned_by_someone_else
FROM shoots s
JOIN app_users u ON lower(u.email) = 'sushmitaghosh0099@gmail.com';
