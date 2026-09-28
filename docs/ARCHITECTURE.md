# Architecture

ShootingTracker is a small application, but it is a *long-lived* one: a single
owner runs it for years, imports messy spreadsheets into it and occasionally
adds a feature. This document explains how the code is organised so that
changes stay cheap and safe.

The guiding idea is the **dependency rule**: dependencies point inwards, towards
the code that expresses the business, and never outwards towards Express, `pg`
or the DOM.

```
                       HTTP (Express)                    Browser (ES modules)
                 ┌──────────────────────┐            ┌────────────────────────┐
  request  ──▶   │ routes / middleware  │            │ ui/ views              │
                 └──────────┬───────────┘            └───────────┬────────────┘
                            │ calls                              │ calls
                 ┌──────────▼───────────┐            ┌───────────▼────────────┐
                 │ services (use cases)  │            │ data/ (API facade)     │
                 └──────────┬───────────┘            └───────────┬────────────┘
                            │ uses                               │ fetch
                 ┌──────────▼───────────┐                        ▼
                 │ repositories (SQL)    │                   /api/…
                 └──────────┬───────────┘
                            │ port
                 ┌──────────▼───────────┐
                 │ persistence (pg)      │
                 └──────────────────────┘

        domain/ (pure rules)  and  core/ (errors, logger, cache) are used by
        every layer above and depend on nothing.
```

---

## Server layers

| Layer | Folder | Responsibility | May depend on |
| --- | --- | --- | --- |
| Entry points | `server/index.js`, `migrate.js`, `import.js`, `seed-demo.js` | Start a process, handle signals, print CLI output | bootstrap |
| Composition root | `server/bootstrap.js`, `server/container.js` | Choose implementations and wire them together — the **only** place that does `new` across layers | everything |
| HTTP | `server/app.js`, `server/http/**` | Translate requests to service calls and results to responses | services, domain, core |
| Services | `server/services/**` | Use cases: orchestration, transactions, policy enforcement | repositories, domain, core |
| Repositories | `server/repositories/**` | SQL for one table/aggregate, nothing else | persistence, domain, core |
| Persistence | `server/persistence/**` | The `pg` driver, pool configuration, schema bootstrap, SQLSTATE translation | core |
| Domain | `server/domain/**` | Pure rules and value objects (`ShootFilter`, `ShootInput`, `AccessPolicy`, statuses) | core |
| Import | `server/import/**` | Sheet → rows: format detection, readers, header mapping, value coercion | domain, core |
| Core | `server/core/**` | Error hierarchy, logger, TTL cache, async handler | — |
| Config | `server/config/index.js` | The only reader of `process.env`; validates and freezes | core |

### The composition root

`server/container.js` builds every object once and passes collaborators in
through constructors:

```js
const shootRepository = new ShootRepository({ database, maxRows });
const shootService    = new ShootService({ database, shootRepository, … });
```

Nothing else imports a live pool, a logger singleton or `process.env`. That is
what makes the rest of the code testable: `test/helpers/fakes.js` swaps a
repository for an in-memory array, and `test/helpers/test-app.js` boots the real
Express stack with stub services — no database anywhere.

---

## How SOLID shows up here

**Single responsibility.** The old `server/index.js` was 567 lines of routing +
auth + SQL + validation + static files + error handling. It is now ~50 lines of
process startup; each of the concerns it used to hold has a file whose name says
what it does. The same happened to `parse.js` (detection / readers / mapping /
coercion) and to the 1,159-line `public/js/app.js` (21 focused modules).

**Open/closed.** The places that used to be if/else chains are now data:

- `server/domain/shoot-filter.js` holds a `FILTER_RULES` array — a new filter is
  a new entry, the builder never changes.
- `server/import/header-mapper.js` holds the header vocabulary as a table.
- `server/import/readers/index.js` is a registry: teaching the importer about
  XLSX means registering one more reader.
- `server/http/routes/index.js` composes one router per resource.

**Liskov substitution.** Every table reader has the same contract
(`read(text) → { headers, data }`), so `SheetParser` can use any of them
interchangeably. `PostgresDatabase` and the `RecordingDatabase` test double
implement the same narrow `Database` port (`query`, `withTransaction`,
`checkHealth`, `close`).

**Interface segregation.** Repositories expose a handful of methods each, and
services receive only the ones they need — `PaymentService` gets the payment and
shoot repositories, not a god object. In the browser,
`data/shooting-tracker-api.js` gives views named use cases
(`listShootsBetween`, `addPayment`) rather than a raw `fetch`.

**Dependency inversion.** Services depend on repository *interfaces* and receive
them; repositories depend on the database *port*, not on `pg`. The clock,
`fetch`, the logger, `confirm` and `localStorage` are injected too, which is why
Google ID-token verification, TTL caching and the theme can be unit-tested with
no network, no timers and no browser.

---

## Error handling

`server/core/errors.js` defines one hierarchy:

```
AppError (500, not exposed)
├── ValidationError        400
├── UnauthorizedError      401
├── ForbiddenError         403
├── NotFoundError          404
├── ConflictError          409
├── ServiceUnavailableError 503
└── ConfigurationError     500 (never exposed)
```

Rules:

1. Throw the closest error from anywhere; never build a response outside the
   HTTP layer.
2. `asyncHandler` forwards rejected promises to Express.
3. `createErrorHandler` is the single place that writes an error response. A
   domain error contributes its status and message; anything else is logged in
   full and answered with `500 {"error":"Internal server error"}` — driver text,
   stack traces and connection strings never reach a client.
4. `persistence/pg-error-translator.js` converts SQLSTATE codes (`23505`,
   `22P02`, …) into domain errors, so services never inspect `error.code`.

---

## Frontend

`public/js/app/` is plain ES modules — no bundler, no build step, loaded with
`<script type="module">`.

| Folder | Contents |
| --- | --- |
| `core/` | DOM helpers, formatting, event bus, store, theme |
| `data/` | `ApiClient` (transport) and `ShootingTrackerApi` (use-case facade) |
| `domain/` | `FilterCriteria`, status vocabulary, CSV export — pure, unit-tested |
| `ui/` | One class per screen or widget; each owns its elements and nothing else |
| `main.js` | Composition root: builds everything, owns routing and the `actions` mediator |

Views never import each other. They receive an `actions` object (open a shoot,
add one, refresh, notify) and report to it; `main.js` decides what actually
happens. Shared state lives in `core/store.js`.

Because dependencies are injected, `test/unit/frontend.test.js` imports these
modules straight into Node and tests them without a DOM.

---

## Testing

```bash
npm test          # 128 unit + integration tests, no database required
```

- `test/unit/**` — domain rules, config, errors, cache, sessions, Google token
  verification (with a locally generated RSA key pair), the import pipeline,
  services against fake repositories, and the browser modules.
- `test/integration/api.test.js` — the real Express app (middleware, guards,
  routers, error handler) over HTTP against stub services: status codes, JSON
  shapes, the auth gate, owner-only access, security headers.
- `scripts/api-test.py` — 47 end-to-end checks against a running server and a
  real database.

---

## Adding a feature

Follow the layers inwards-out; each step has one obvious home.

*Example: “shoots need an invoice number”.*

1. `server/schema.sql` — add the column.
2. `server/domain/shoot-input.js` — add it to `WRITABLE_SHOOT_COLUMNS` (and a
   validation rule if it has one).
3. `server/repositories/shoot-queries.js` — add it to `SHOOT_COLUMNS` if the API
   should return it.
4. Filterable? Add one rule to `FILTER_RULES`.
5. Importable? Add one line to `FIELD_RULES`.
6. UI: render it in `ui/shoot-drawer.js`, add the input to `index.html` and to
   `ui/shoot-form.js`.
7. Tests: a case in `test/unit/shoot-input.test.js`, and one in
   `test/integration/api.test.js` if the contract changed.

No step requires touching the router, the error handler, the container or any
unrelated view.
