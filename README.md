# 📷 ShootingTracker

A self-hosted, **mobile-first** tool to **track every shoot**, with a **filterable earnings dashboard**
and a **calendar linked to each shoot** — all backed by **PostgreSQL** (your Aiven `defaultdb`).

Built with a small **Node.js + Express + `pg`** API and a dependency-free frontend (ES modules, no build
step), so it runs anywhere Node runs. A **violet material theme** in **light and dark** (one tap in the
top-right corner, remembered per browser): solid surfaces, soft elevation, fully rounded controls, and a
floating **navigation pill** — the current view rides a lifted disc — next to a circular **action button**
that adds a shoot from anywhere.

---

## Features

- **Shoot tracking (CRUD)** — a minimal form (title, date, client, coordinator, fee, status) with the rest
  (type, end date/times, venue, location, contacts, notes) tucked under “More details”. Anything that
  doesn't fit a column is preserved in a JSON `extra` field, so you never lose data from a sheet.
- **Two statuses, everywhere** — a shoot is either **Planned** (still to come) or **Completed** (closed
  out). Filters, pills, calendar chips, the legend and the donut all speak those two words, and an import
  that says “booked”, “confirmed”, “postponed” or “cancelled” is folded into the right one.
- **Earnings** — a per-shoot **payments ledger**. Collected amount, balance and a derived
  `paid / partial / unpaid` status are computed from the ledger, not hand-typed. In the shoot
  drawer, **Mark Complete** and **Mark Paid** sit side by side under the ledger: one closes the shoot,
  the other books whatever is still due on the fee in a single tap.
- **Dashboard** — six KPI cards in count/amount pairs (total shoots, total fee · completed, total received · planned, outstanding) plus:
  - monthly earnings bar chart (per-day when a month filter is on),
  - status donut,
  - **Upcoming Shoots** for the next 7 days, listed as date + title — and once it is past **7 pm IST on the
    day of a shoot**, that row grows two icon buttons to close it out on the spot: mark it complete, and
    collect the balance,
  - per-**coordinator** and per-**type** breakdowns.
  Every widget respects the shared filter bar: **month, coordinator, client, status, type, fee range,
  text search, payment status**.
- **Calendar** — Google-style month grid: cells share their edges (no gaps), today is highlighted, days from
  the neighbouring months are dimmed, and every shoot is shown on its date (multi-day shoots span their
  range) as a status-coloured chip. The legend mirrors those chips and counts the statuses in the month on
  screen. Tap a shoot → detail drawer; tap a day → add a shoot on that date. A list view is one tap away.
- **Mobile-first UI** — responsive layout, bottom-sheet forms/drawers, safe-area insets, and a floating
  navigation pill (Dashboard / Calendar / Shoots / Profile) with a violet **floating action button** beside
  it for “new shoot”. The **All shoots** table goes edge-to-edge on phones and drops its
  **Status** and **Payment** columns; the fee itself turns into a **green bubble when paid** and a **red
  bubble when a balance is due**. A **Show All** button appears whenever a filter is applied, and **Export
  (CSV)** lives next to the filter icon in the same header.
- **Fresh every time** — a tab always opens in its default state, scrolled back to the top: no leftover
  filters, no expanded month groups, and the calendar back on the current month. Dialogs do the same — the shoot form reopens empty
  with “More Details” folded away and scrolled to the top. The one deliberate exception is a dashboard
  tile, which carries its filter into the Shoots tab on purpose.
- **Boot splash** — a wordless brand mark is painted straight from the HTML (before any script runs) and
  leaves as soon as the first view has its data — and in any case within 1.5 s, however slow the network.
- **Motion** — views cross-fade, month groups expand and collapse to their real height, the filter bar
  slides open, and every sheet, dialog and drawer animates both in *and* out (the "+" button raises the
  shoot form, closing it lets the sheet fall away). Anyone whose OS asks for reduced motion gets the same
  interactions instantly, with no animation at all.
- **Wording** — everything the UI labels (tabs, headings, table columns, form fields, buttons, status
  chips) is **Title Case**; anything that reads as a sentence (empty states, hints, toasts, tooltips) stays
  sentence case.
- **Light / dark theme** — the toggle sits in the **top-right corner** (moon ⇄ sun). The choice is stored in
  the browser, follows the operating system until you pick a side, and is applied before the first paint, so
  there is no white flash on load. Dark mode is a **true-black canvas** with near-black cards separated by
  hairlines (shadows are invisible on black), white copy, cool-grey secondary text and mint/amber/red for
  money states. Every surface — cards, tables, calendar, drawer, pills, the navigation
  pill and the action button — is themed from one set of CSS custom properties in `public/css/app.css`
  (palette, radii, elevation and the navigation metrics), so a re-skin is a token edit, not a hunt.
- **Profile view** — the fourth destination in the bottom bar, opening as a full view like the others
  (no popup): the signed-in account with its avatar, email and role, plus **Sign Out** and, for owners,
  **People with Access**.
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
| `app_users`    | Who may sign in (email, role `owner`/`member`, active flag).    |

Key indexes: shoot date, coordinator, client, status, type, and a GIN index on `extra`.

> **Aiven note:** Aiven blocks connections from cloud/datacenter IP ranges by default. If you see
> “DB unreachable”, add your egress IP (or `0.0.0.0/0` for a quick test) to the service **IP allowlist** in
> the Aiven console. The connection string in `.env` already sets `sslmode=require`.

### Troubleshooting connection errors

| Error in the UI pill/banner | Cause | Fix |
| --- | --- | --- |
| `self-signed certificate in certificate chain` | A corporate TLS-inspection proxy (Citrix, Zscaler, Netskope, …) re-signs traffic with a CA that Node doesn't trust. The browser works because the CA is in the OS store. | Already handled: the app connects with certificate verification off for remote hosts (see `server/persistence/pool-config.js`). Pull the latest code and restart. To keep verification, set `NODE_EXTRA_CA_CERTS=/path/to/corporate-ca.crt` in your environment. |
| `connection terminated unexpectedly` (fast, ~100 ms) | Your machine's IP is not on the Aiven allowlist. | Add your egress IP to the service **IP allowlist** in the Aiven console. |
| `database "…" does not exist` | The `DATABASE_URL` points at a database that hasn't been created. | Use an existing database (e.g. `defaultdb`) or create one in the Aiven console, then apply `server/schema.sql` (+ your import SQL) to **that** database. |

> **Why verification is off for remote hosts:** since pg 8.16 (`pg-connection-string`), a URL with
> `?sslmode=require` is parsed into `ssl: {}`, which *overrides* an explicit `ssl` option in the Pool
> config — so Node silently re-enables certificate validation. `server/persistence/pool-config.js` parses the URL itself and
> passes `ssl: { rejectUnauthorized: false }` for remote hosts, which is predictable and safe enough for a
> dev tool. Data and password still travel over TLS either way.

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
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
SESSION_SECRET=use-a-long-random-secret
```

Everything the server reads from the environment is declared and validated in
`server/config/index.js`; a bad value fails at startup with a clear message
instead of at the first request. Optional settings:

| Variable | Default | Purpose |
| --- | --- | --- |
| `LOG_LEVEL` | `debug` (`info` in production) | `silent` · `error` · `warn` · `info` · `debug` |
| `SESSION_TTL_SECONDS` | `604800` (7 days) | Session lifetime |
| `ALLOWLIST_CACHE_MS` | `20000` | How long an allow-list lookup is cached |
| `DB_POOL_MAX`, `DB_CONNECTION_TIMEOUT_MS`, `DB_IDLE_TIMEOUT_MS` | `10`, `10000`, `30000` | Pool tuning |
| `SHOOT_LIST_MAX_ROWS` | `2000` | Safety limit on `GET /api/shoots` |
| `FRAME_OPTIONS` | `SAMEORIGIN` | `none` to allow embedding the app in an iframe |
| `DEV_SIGN_IN_EMAIL` | — | **Development only.** Treat every request as this account so the app can be opened without Google credentials. The account must still be active in `app_users`, and the server refuses to start with it set when `NODE_ENV=production`. |

### Google-only access

The app and every `/api` endpoint require a Google sign-in. The server verifies Google's signed ID token and
then checks the account against the **`app_users`** table; the allow-list is enforced on the server, not just by
the sign-in screen. Signed-in sessions use an HTTP-only, same-site cookie and expire after seven days.

Managing who can sign in — **no code changes and no restart needed**:

- From the app: an owner opens the **Profile** tab → *People with Access* (add,
  activate/deactivate, promote, remove).
- From the database: `INSERT INTO app_users (email, name, role) VALUES ('new@example.com', 'New', 'member');`
  or `UPDATE app_users SET is_active = false WHERE lower(email) = '…';`

The two original logins are seeded by the first `npm run migrate` (existing databases pick them up on the next
migration run). Owners can never demote, deactivate or remove the last active owner, and nobody can remove
their own access. The allow-list is cached for 20 s, so a change takes effect within half a minute.

1. In Google Cloud Console, configure the Google Identity Services OAuth consent screen and create an **OAuth client ID** of type **Web application**.
2. Add each hostname where this app runs to **Authorized JavaScript origins** (for local development, `http://localhost:3000`; add your production HTTPS origin too). No redirect URI is needed.
3. Set `GOOGLE_CLIENT_ID` to that web client ID and `SESSION_SECRET` to a long random value (`openssl rand -hex 32` is a good way to generate one). Keep both values in the server environment; the client ID is public by design, but the session secret is not.
4. Restart the app. Without a Google client ID, the sign-in page displays a configuration message and does not grant access. In production, serve over HTTPS so the session cookie is Secure.

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

**a) CLI → database**

```bash
npm run import -- April.html              # insert into DATABASE_URL
npm run import -- April.html --dry-run    # parse + summary only
```

**b) CLI → SQL file for the Aiven console** (when you'd rather paste SQL)

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

Every `/api` route except `/api/auth/config`, `/api/auth/google` and
`/api/auth/logout` requires a signed-in session; without one they answer
`401 {"error":"Sign-in required"}`.

| Method & path                              | Description                                        |
| ------------------------------------------ | -------------------------------------------------- |
| `GET /api/auth/config`                     | Public Google client ID for the sign-in page       |
| `GET /api/auth/me`                         | The signed-in account (email, name, role)          |
| `POST /api/auth/google`                    | Exchange a Google credential for a session cookie  |
| `POST /api/auth/logout`                    | Clear the session cookie                           |
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
| `DELETE /api/coordinators/:id`             | Delete one (409 while shoots still reference it)   |
| `GET/POST /api/users`, `PATCH/DELETE /api/users/:id` | Manage the allow-list (owners only)      |

**Error shape.** Every failure is `{ "error": "…" }` with a meaningful status:
`400` validation, `401` no session, `403` not an owner, `404` unknown id, `409`
a rule would be broken (last owner, coordinator in use), `503` the database is
unreachable. Unexpected failures are logged server-side and answered with a
generic `500` — internal details are never returned.

**Filter query params** (any combination): `month=YYYY-MM`, `year`, `from`, `to`, `coordinator` (name or id),
`client`, `status` (csv), `type`, `minFee`, `maxFee`, `paymentStatus=paid|partial|unpaid`, `q=…`.

---

## 5 · Tests

```bash
npm test             # 128 unit + integration tests — no database, no network
```

`npm test` uses the built-in Node test runner (no dependencies) and covers the
domain rules, the import pipeline, sessions and Google token verification, the
services (against in-memory repositories), the whole Express stack over HTTP,
and the browser modules.

End-to-end, against a running server and a real database:

```bash
npm run dev:pg                                    # throwaway Postgres (another shell)
DATABASE_URL=… npm run migrate && npm run seed:demo
DATABASE_URL=… npm start &
ST_COOKIE=$(npm run --silent dev:session) npm run api-test    # 47 checks
```

`npm run dev:session` mints a signed session cookie from your `SESSION_SECRET`
so scripts can call the API without going through Google. The account still has
to be active in `app_users`.

---

## Project layout

The code is layered — routes → services → repositories → database — with
dependencies injected from a single composition root. See
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the rules and for a worked
example of adding a feature.

```
server/
  index.js          # process entry point: listen + graceful shutdown
  app.js            # Express composition (middleware, routers, error handler)
  bootstrap.js      # .env → config → logger → container
  container.js      # composition root: builds and wires everything
  config/           # the only reader of process.env; validated + frozen
  core/             # error hierarchy, logger, TTL cache, async handler
  domain/           # pure rules: filters, shoot input, access policy, statuses
  repositories/     # one SQL module per table/aggregate
  persistence/      # pg pool, type parsers, schema bootstrap, error translation
  services/         # use cases: shoots, payments, media, access, auth, import
  import/           # format detection, HTML/CSV/JSON readers, header + value mapping
  http/             # middleware (auth, errors, security headers) + one router per resource
  schema.sql        # idempotent DDL (paste into Aiven)
  migrate.js · import.js · seed-demo.js   # CLIs, all built on the same container
public/
  index.html        # SPA shell
  css/app.css       # light + dark theme
  js/app/           # ES modules, no build step:
    main.js         #   composition root, routing, action mediator
    core/           #   dom, formatting, store, event bus, theme
    data/           #   ApiClient (transport) + ShootingTrackerApi (use cases)
    domain/         #   filter criteria, status vocabulary, CSV export
    ui/             #   one class per screen: dashboard, calendar, shoots, drawer, …
test/
  unit/             # domain, services, import, auth, frontend modules
  integration/      # the Express app over HTTP with stub services
  helpers/          # fakes and a test-app factory
scripts/
  dev-postgres.js   # embedded local Postgres for dev
  dev-session.js    # mint a session cookie for local API testing
  api-test.py       # e2e API test suite
docs/
  ARCHITECTURE.md   # layers, SOLID rationale, how to add a feature
data/
  sample-sheet.html
```
