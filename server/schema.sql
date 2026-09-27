-- ============================================================
-- ShootingTracker schema (PostgreSQL)
-- Idempotent: safe to run repeatedly (including in the Aiven
-- web console — just paste this whole file and run).
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
  extra          JSONB NOT NULL DEFAULT '{}'::jsonb,  -- unmapped columns from imports
  dedupe_hash    TEXT,                -- md5 used to keep re-imports idempotent
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT shoots_dates_check CHECK (end_date IS NULL OR end_date >= shoot_date)
);

CREATE UNIQUE INDEX IF NOT EXISTS shoots_dedupe_hash_uq ON shoots (dedupe_hash);
CREATE INDEX IF NOT EXISTS shoots_date_idx      ON shoots (shoot_date);
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

-- ---------- app users (who may sign in) ----------
-- Sign-in is Google-only; this table is the allow-list, so access is managed in
-- the database (or from the app's "People with access" screen) instead of in code.
CREATE TABLE IF NOT EXISTS app_users (
  id          SERIAL PRIMARY KEY,
  email       TEXT NOT NULL,
  name        TEXT,
  role        TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS app_users_email_uq ON app_users (lower(email));

-- one-time seed: the accounts that used to be hard-coded in server/auth.js.
-- Safe to re-run; afterwards manage rows in the table (or from the app).
INSERT INTO app_users (email, name, role) VALUES
  ('sumit2nandi@gmail.com', 'Sumit Nandi', 'owner'),
  ('sushmitaghosh0099@gmail.com', 'Sushmita Ghosh', 'member')
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
