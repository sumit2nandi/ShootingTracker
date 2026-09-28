# Refactor notes

What changed when the codebase was restructured around the layering described
in [`ARCHITECTURE.md`](ARCHITECTURE.md), and what that means for anyone using
the app or the API.

## 2026-09 · Per-user data, owner view mode, consent sign-in and first-login tour

This section **supersedes “Contract: unchanged”** for the endpoints it names.
The app used to show every signed-in account the same global data; now each
account has its own.

**Schema.** `app_users` gains `tour_completed` (default `FALSE`); `shoots`
gains `owner_id` (FK → `app_users.id`, `ON DELETE SET NULL`, indexed). Payments
and media follow their shoot. The DDL in `server/schema.sql` is still
idempotent and now *converges* older databases: missing columns are added and
the FK is attached in a `DO` block that checks `pg_constraint` (Postgres has no
`ADD CONSTRAINT IF NOT EXISTS`).

**Data scope.** Every `/api` request resolves a `DataScope { selfId, targetId }`
(`server/domain/data-scope.js` + `services/data-scope-service.js` +
`http/middleware/data-scope.js`):

- reads filter by `targetId` — the signed-in account by default;
- writes always belong to `selfId`;
- `?viewingAs=account@x.com` on read endpoints switches an **owner**'s reads
  to another account (case-insensitive; deactivated accounts are viewable);
  members' `viewingAs` is ignored, an unknown email is a `400`;
- a record that isn't yours (or that isn't the owner's viewing target) is a
  `404` — update, delete, payments and media all enforce this.

**Sign-in contract.** `POST /api/auth/google` for an account **not in
`app_users`** now answers `200 { user, needsConsent: true }` with **no**
session cookie; the login page shows a consent form and calls the new public
`POST /api/auth/consent { credential, name? }`, which re-verifies the token,
creates the account as a member (`tour_completed = FALSE`) and issues the
session. Deactivated accounts are refused by both endpoints with `403`
(`This account has been deactivated…`) — no self re-activation.

**`GET /api/auth/me`** now returns `{ id, email, name, role, tour_completed }`.
New `POST /api/auth/me/tour-completed` marks the flag so the front-end's
spotlight tour (`public/js/app/ui/tour.js`) runs once, for new accounts.

**Frontend.** The Profile tab gains a *Viewing* switch for owners (persisted
in `localStorage: shootingtracker-viewing-as`, validated against the user list
at boot); while viewing another account an amber banner is shown, the
`body.viewing-other` class hides the “new shoot” buttons and the drawer and
dashboard row actions go read-only. Members see their own profile only, as
before.

**CLI.** `npm run import` accepts `--owner email` (rows belong to that account;
without it they stay unowned and a warning is printed).
`npm run assign:existing [email] [--all]` re-homes pre-existing shoots to an
account (default `sushmitaghosh0099@gmail.com`), creates it if missing, marks
tours done, and is idempotent.

**Tests.** `npm test` now covers 153 cases, including the data-scope rules,
the consent flow and the `viewingAs` passthrough. `scripts/api-test.py` passes
unmodified (47 checks; its one “test coordinators removed” quirk when running
against a `seed:demo` database predates this change — the demo and the suite
use the same coordinator names, and the delete is correctly refused while demo
shoots still reference them).

## Contract: unchanged (superseded where the 2026-09 section says otherwise)

Every route path, query parameter and successful JSON response shape is the
same as before — including the lowercase KPI aliases (`paidshoots`,
`outstandingshoots`), `paid_amount`, `payment_status` and the `{ ok: true }`
replies. `scripts/api-test.py` passes unmodified apart from the session cookie
it now has to send (the API always required one; the suite simply never sent
it).

## Bug fixes

| # | Symptom | Cause | Fix |
| --- | --- | --- | --- |
| 1 | **“+ New shoot” and “Edit” did nothing** — the modal never opened | `form.id` and `form.title` resolve to the form element's own `id`/`title` attributes (strings), not to the inputs named `id`/`title`, so `form.id.value = …` threw a `TypeError` in strict mode on the first line of the open routine | all form access goes through `form.elements.namedItem(name)` (`public/js/app/ui/shoot-form.js`) |
| 2 | Allow-list lookups were cached wrong: one shared timestamp for all entries, and every write replaced the whole map | a single `{ at, byEmail }` object | `core/ttl-cache.js` — per-entry expiry, injectable clock, bounded size |
| 3 | Deactivating the last owner briefly wrote the change and then undid it (a crash or a concurrent request could leave the workspace ownerless) | the check ran *after* the `UPDATE` | `domain/access-policy.js` decides before anything is written |
| 4 | `PUT`/`DELETE /api/shoots/:id` answered `{ ok: true }` for ids that do not exist | no row count check | `404 { "error": "not found" }` |
| 5 | Posting a payment or media link to a missing shoot inserted an orphan or failed with a 500 | no parent check | `404`, after an existence check |
| 6 | A non-numeric id (`/api/shoots/abc`) produced a `500` with raw driver text | the value went straight into SQL | `400 { "error": "shoot id must be a positive integer" }` |
| 7 | Any unexpected failure returned `err.message` — connection strings, SQL fragments and driver internals could leak to the client | the error handler echoed the message | domain errors keep their message; everything else is logged and answered with a generic `500` |
| 8 | `coordinator_id` sent on its own was ignored (it only worked when `coordinator` was sent too) | the branch required both keys | an explicit `coordinator_id` is honoured and wins over a name |
| 9 | Every imported row carried a junk `_unused_year` field | leftover from an earlier mapper | removed |
| 10 | The dashboard's "next 7 days" query built its WHERE clause by regex-stripping the word `WHERE` from another clause | string surgery on SQL | `ShootFilter.toSql({ extraConditions })` |
| 11 | The **Client** and **Type** filter dropdowns existed in the UI but were never populated and never read | they were missing from the filter code | wired up (the API already supported both) |
| 12 | Payment amounts were not validated (`amount: "abc"` reached Postgres) | no check | `400` unless the amount is a finite number ≥ 0 |
| 13 | A bad `PORT`, `LOG_LEVEL` or `SESSION_TTL_SECONDS` failed later, in confusing ways | no config validation | `loadConfig` validates at startup and fails with a clear message |
| 14 | `SIGTERM`/`SIGINT` killed the process mid-transaction | no shutdown handling | graceful shutdown: stop accepting connections, drain the pool, exit |

## New behaviour

- **Security headers** on every response: `X-Content-Type-Options`,
  `X-Frame-Options` (configurable via `FRAME_OPTIONS`), `Referrer-Policy`,
  `Cross-Origin-Opener-Policy`, `Permissions-Policy`; `X-Powered-By` removed.
- **Request logging** — one line per request at `debug`, errors at `error`,
  controlled by `LOG_LEVEL`.
- **`DEV_SIGN_IN_EMAIL`** — development-only sign-in bypass so the app can be
  opened without Google credentials. The account must still be active in
  `app_users`, and the server refuses to start with it set when
  `NODE_ENV=production`.
- **`npm test`** — 128 unit and integration tests on the built-in Node runner.
- **`npm run dev:session`** — mints a session cookie for local API testing;
  `scripts/api-test.py` reads it from `ST_COOKIE`.
- **`npm run dev:pg`** now reuses the existing dev cluster and takes `--fresh`
  to wipe it (this replaces the duplicated `scripts/dev-db.js`).

## Files

| Removed | Replaced by |
| --- | --- |
| `server/db.js` | `server/persistence/{postgres-database,pool-config,type-parsers}.js` |
| `server/auth.js` | `server/services/{session-service,google-identity-verifier,authentication-service}.js` |
| `server/users.js` | `server/repositories/user-repository.js`, `server/services/{user-directory,access-service}.js`, `server/persistence/schema-initializer.js`, `server/domain/access-policy.js` |
| `server/parse.js` | `server/import/**` (format detector, three readers, header mapper, value parsers, row mapper, sheet parser) |
| `server/import-core.js` | `server/services/shoot-importer.js`, `server/import/sql-emitter.js` |
| `server/index.js` (567 lines) | `server/index.js` (entry point), `server/app.js`, `server/http/**`, `server/services/**`, `server/repositories/**`, `server/domain/**` |
| `public/js/app.js` (1,159 lines) | `public/js/app/**` (21 ES modules) |
| `scripts/dev-db.js` | `scripts/dev-postgres.js --fresh` |

`index.html` now loads `js/app/main.js` as a module; there is still **no build
step**.
