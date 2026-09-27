# 📷 ShootingTracker

A self-hosted, **mobile-first** tool to **track every shoot**, with a **filterable earnings dashboard**
and a **calendar linked to each shoot** — all backed by **PostgreSQL** (your Aiven `defaultdb`).

Built with a small **Node.js + Express + `pg`** API and a dependency-free frontend (vanilla JS, no build
step), so it runs anywhere Node runs. Professional **light theme**, with a floating **liquid-glass bottom
tab bar** on mobile.

---

## Features

- **Shoot tracking (CRUD)** — a minimal form (title, date, client, coordinator, fee, status) with the rest
  (type, end date/times, venue, location, contacts, notes) tucked under “More details”. Anything that
  doesn't fit a column is preserved in a JSON `extra` field, so you never lose data from a sheet.
- **Earnings** — a per-shoot **payments ledger**. Collected amount, balance and a derived
  `paid / partial / unpaid` status are computed from the ledger, not hand-typed.
- **Dashboard** — KPI cards (shoots, total fee value, collected, outstanding, active, completed) plus:
  - monthly **fee vs collected** bar chart,
  - status donut,
  - per-**coordinator** and per-**type** breakdowns,
  - upcoming shoots.
  Every widget respects the shared filter bar: **month, coordinator, client, status, type, fee range,
  text search, payment status**.
- **Calendar** — month grid, every shoot shown on its date (multi-day shoots span their range), color-coded
  by status. Tap a shoot → detail drawer; tap a day → add a shoot on that date.
- **Mobile-first UI** — responsive layout, tables drop low-priority columns on small screens, bottom-sheet
  forms/drawers, safe-area insets, and a floating glass tab bar (Dashboard / Calendar / Shoots).
- **Import (server-side)** — an **HTML spreadsheet export / CSV / JSON** sheet can be loaded via the REST
  API (`POST /api/import`) or the CLI (`npm run import`). Columns like `date`, `client`, `coordinator`,
  `fee`, `venue`, `status`, `payment` are auto-mapped (many date formats, `Paid`/`50%`/amounts for
  payments). Unmapped columns are stored in `extra`. **Re-imports are idempotent** (dedupe hash).
- **DB status pill** — shows connectivity; a banner explains what to do if the DB is unreachable.

---

## 1 · Database setup (Aiven)

The schema is idempotent — paste it into the Aiven web console once (or run `npm run migrate`).

```bash
# apply the base schema to the configured DATABASE_URL
npm run migrate
```

Tables created:

| Table          | Purpose                                                        |
| -------------- | -------------------------------------------------------------- |
| `coordinators` | People who handle shoots (unique by name, case-insensitive).   |
| `shoots`       | One row per shoot + `extra` JSONB + `dedupe_hash` for imports. |
| `payments`     | Earnings ledger (amount, date, method) per shoot.              |
| `media`        | Photo / album / drive links per shoot.                         |

Key indexes: shoot date, coordinator, client, status, type, and a GIN index on `extra`.

> **Aiven note:** Aiven blocks connections from cloud/datacenter IP ranges by default. If you see
> “DB unreachable”, add your egress IP (or `0.0.0.0/0` for a quick test) to the service **IP allowlist** in
> the Aiven console. The connection string in `.env` already sets `sslmode=require`.

---

## 2 · Configure & run

```bash
cp .env.example .env      # then edit DATABASE_URL + PORT
npm install
npm start                 # → http://localhost:3000
```

`.env`:

```ini
DATABASE_URL=postgres://USER:PASSWORD@HOST:PORT/DATABASE?sslmode=require
PORT=3000
```

> The checked-in `.env` already points at your Aiven `defaultdb` for convenience. It is **git-ignored**;
> treat it like a secret.

### Local dev database (no Aiven needed)

```bash
npm run dev:pg            # throwaway Postgres on 127.0.0.1:5433 (db=dev, user=dev, pass=dev)
# in another shell:
DATABASE_URL=postgres://dev:dev@127.0.0.1:5433/dev npm start
npm run seed:demo         # optional: ~60 clearly-labelled demo shoots
```

---

## 3 · Import your data

Three equivalent ways. All are idempotent — safe to run repeatedly.

**a) In the UI** — `Import` tab → drop or paste an HTML/CSV/JSON sheet → **Preview (dry run)** →
**Import into DB**.

**b) CLI → database**

```bash
npm run import -- April.html              # insert into DATABASE_URL
npm run import -- April.html --dry-run    # parse + summary only
```

**c) CLI → SQL file for the Aiven console** (when you'd rather paste SQL)

```bash
npm run import -- April.html --emit-sql data/import.sql
# open data/import.sql, paste into the Aiven console, run
```

A ready-made example sheet lives at [`data/sample-sheet.html`](data/sample-sheet.html).

### Auto-mapping

| Target column   | Recognised headers (examples)                                          |
| --------------- | ---------------------------------------------------------------------- |
| `shoot_date`    | date, shoot date, scheduled date, booking date                         |
| `client_name`   | client, client name, customer, brand, couple                           |
| `shoot_type`    | type, category, occasion, shoot type                                   |
| `coordinator`   | coordinator, staff, photographer, assigned to, person in charge        |
| `fee`           | fee, amount, price, earnings, rate, charge, total                      |
| `paid` (→ledger)| paid, payment, advance, payment status (`Paid`, `7500`, `50%`, `No`)   |
| `venue`/`location`, `status`, `notes`, phone, times | venue, hall, city, location, status, remarks, notes |

Anything else is captured in `extra` and shown under “Extra fields” in the shoot drawer.

---

## 4 · API (all JSON)

Base: `http://localhost:3000`

| Method & path                              | Description                                        |
| ------------------------------------------ | -------------------------------------------------- |
| `GET /api/health`                          | DB connectivity + latency                          |
| `GET /api/meta`                            | Coordinator/client/type/month lists for filters    |
| `GET /api/dashboard`                       | KPIs + aggregates (honours all filters)            |
| `GET /api/shoots`                          | List, filtered (see below)                         |
| `GET /api/shoots/:id`                      | Detail + payments + media                          |
| `POST /api/shoots`                         | Create (auto-upserts coordinator by name)          |
| `PUT /api/shoots/:id`                      | Update                                             |
| `DELETE /api/shoots/:id`                   | Delete (cascades payments/media)                   |
| `POST /api/shoots/:id/payments`            | Record a payment                                   |
| `DELETE /api/payments/:id`                 | Remove a payment                                   |
| `POST /api/shoots/:id/media`               | Add a media link                                   |
| `DELETE /api/media/:id`                    | Remove a media link                                |
| `POST /api/import`                         | `{ content, format?, dryRun }` → parse/import      |
| `POST /api/coordinators`                   | Upsert a coordinator                               |

**Filter query params** (any combination): `month=YYYY-MM`, `year`, `from`, `to`, `coordinator` (name or id),
`client`, `status` (csv), `type`, `minFee`, `maxFee`, `paymentStatus=paid|partial|unpaid`, `q=…`.

---

## 5 · Tests

```bash
npm start &          # (or dev:pg + seeded)
python3 scripts/api-test.py            # 36 end-to-end checks: filters, CRUD, payments, media, import
```

---

## Project layout

```
server/
  index.js        # Express app + REST API
  db.js           # pg pool, type parsers, health check
  schema.sql      # idempotent DDL (paste into Aiven)
  migrate.js      # applies schema.sql
  parse.js        # HTML/CSV/JSON → normalized shoot rows
  import-core.js  # idempotent DB import + standalone .sql emitter
  import.js       # CLI importer
  seed-demo.js    # demo data
public/
  index.html      # SPA shell
  css/app.css     # dark studio theme
  js/app.js       # dashboard, calendar, CRUD, import UI
scripts/
  dev-postgres.js # embedded local Postgres for dev
  api-test.py     # e2e API test suite
data/
  sample-sheet.html
```
