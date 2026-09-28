'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  RecordingDatabase, FakeShootRepository, FakePaymentRepository, FakeMediaRepository,
  FakeCoordinatorRepository, FakeUserRepository, noopSchemaInitializer
} = require('../helpers/fakes');

const { ShootService } = require('../../server/services/shoot-service');
const { PaymentService } = require('../../server/services/payment-service');
const { MediaService } = require('../../server/services/media-service');
const { CoordinatorService } = require('../../server/services/coordinator-service');
const { DashboardService } = require('../../server/services/dashboard-service');
const { MetadataService } = require('../../server/services/metadata-service');
const { AccessService } = require('../../server/services/access-service');
const { UserDirectory } = require('../../server/services/user-directory');
const { ImportService } = require('../../server/services/import-service');
const { NotFoundError, ValidationError, ConflictError, ServiceUnavailableError } = require('../../server/core/errors');

function shootServiceWith(shoots = []) {
  const database = new RecordingDatabase();
  const repositories = {
    shootRepository: new FakeShootRepository(shoots),
    paymentRepository: new FakePaymentRepository(),
    mediaRepository: new FakeMediaRepository(),
    coordinatorRepository: new FakeCoordinatorRepository([{ id: 1, name: 'Riya Saha' }])
  };
  return { service: new ShootService({ database, ...repositories }), database, ...repositories };
}

test('creating a shoot upserts a coordinator by name inside one transaction', async () => {
  const { service, database, coordinatorRepository, shootRepository } = shootServiceWith();

  const { id } = await service.create({
    title: 'Beach wedding', shoot_date: '2026-04-02', coordinator: 'New Person', fee: '15000'
  });

  assert.ok(id);
  assert.deepEqual(database.statements, ['BEGIN', 'COMMIT']);
  assert.equal(coordinatorRepository.rows.length, 2);
  assert.equal(shootRepository.inserted[0].coordinator_id, 2);
  assert.equal(shootRepository.inserted[0].fee, 15000);
  assert.equal(shootRepository.inserted[0].coordinator, undefined, 'the name never reaches a column');
});

test('a failed insert rolls back the coordinator upsert', async () => {
  const { service, database, shootRepository } = shootServiceWith();
  shootRepository.insert = async () => {
    throw new Error('constraint violation');
  };

  await assert.rejects(
    service.create({ title: 'x', shoot_date: '2026-04-02', coordinator: 'Temp Person' }),
    /constraint violation/
  );
  assert.deepEqual(database.statements, ['BEGIN', 'ROLLBACK']);
});

test('the detail view combines the shoot with its ledger and media', async () => {
  const { service, paymentRepository, mediaRepository } = shootServiceWith([{ id: 7, title: 'Shoot' }]);
  await paymentRepository.insert({ shoot_id: 7, amount: 500 });
  await mediaRepository.insert({ shoot_id: 7, file_url: 'https://example/album' });

  const detail = await service.getDetail(7);
  assert.equal(detail.title, 'Shoot');
  assert.equal(detail.payments.length, 1);
  assert.equal(detail.media.length, 1);
});

test('missing shoots are reported as not found, not as an empty success', async () => {
  const { service } = shootServiceWith();
  await assert.rejects(service.getDetail(404), NotFoundError);
  await assert.rejects(service.update(404, { title: 'x' }), NotFoundError);
  await assert.rejects(service.remove(404), NotFoundError);
});

test('payments validate the amount and the parent shoot', async () => {
  const shootRepository = new FakeShootRepository([{ id: 1, title: 'Shoot' }]);
  const service = new PaymentService({ shootRepository, paymentRepository: new FakePaymentRepository() });

  await assert.rejects(service.record(1, {}), /amount required/);
  await assert.rejects(service.record(1, { amount: 'plenty' }), ValidationError);
  await assert.rejects(service.record(1, { amount: -5 }), ValidationError);
  await assert.rejects(service.record(99, { amount: 10 }), NotFoundError);

  const { id } = await service.record(1, { amount: '4000' });
  assert.ok(id);
});

test('zero is a valid payment amount', async () => {
  const service = new PaymentService({
    shootRepository: new FakeShootRepository([{ id: 1 }]),
    paymentRepository: new FakePaymentRepository()
  });
  await assert.doesNotReject(service.record(1, { amount: 0 }));
});

test('media requires a URL and an existing shoot', async () => {
  const service = new MediaService({
    shootRepository: new FakeShootRepository([{ id: 1 }]),
    mediaRepository: new FakeMediaRepository()
  });
  await assert.rejects(service.attach(1, { caption: 'no url' }), /file_url required/);
  await assert.rejects(service.attach(2, { file_url: 'https://x' }), NotFoundError);
  assert.ok((await service.attach(1, { file_url: ' https://x ' })).id);
});

test('a coordinator with shoots cannot be deleted', async () => {
  const shootRepository = new FakeShootRepository([{ id: 1, coordinator_id: 1 }]);
  const coordinatorRepository = new FakeCoordinatorRepository([{ id: 1, name: 'Riya' }, { id: 2, name: 'Sam' }]);
  const service = new CoordinatorService({ shootRepository, coordinatorRepository });

  await assert.rejects(service.remove(1), ConflictError);
  assert.deepEqual(await service.remove(2), { id: 2, name: 'Sam' });
  await assert.rejects(service.remove(2), NotFoundError);
  await assert.rejects(service.upsert({ name: '  ' }), /name required/);
});

test('the dashboard passes one identical filter to every aggregate', async () => {
  const seen = [];
  const stub = (value) => async (filter) => {
    seen.push(filter);
    return value;
  };
  const service = new DashboardService({
    analyticsRepository: {
      kpis: stub({ shoots: 3 }),
      monthlyTotals: stub([]),
      totalsByCoordinator: stub([]),
      totalsByType: stub([]),
      countsByStatus: stub([]),
      upcoming: stub([]),
      needsAttention: stub([])
    }
  });

  const result = await service.summarize({ month: '2026-04', bogus: 'ignored' });
  assert.deepEqual(Object.keys(result), ['kpi', 'monthly', 'byCoordinator', 'byType', 'byStatus', 'upcoming', 'attention']);
  assert.equal(seen.length, 7);
  assert.ok(seen.every((filter) => filter === seen[0]), 'the same filter instance is reused');
  assert.deepEqual(seen[0].criteria, { month: '2026-04' });
});

test('metadata exposes the two statuses the domain knows', async () => {
  const service = new MetadataService({
    coordinatorRepository: new FakeCoordinatorRepository([{ id: 1, name: 'Riya' }]),
    metadataRepository: {
      distinctClients: async () => ['acme'],
      distinctTypes: async () => ['wedding'],
      months: async () => ['2026-04']
    }
  });
  const meta = await service.describe();
  assert.deepEqual(meta.statuses, ['planned', 'completed']);
  assert.deepEqual(meta.clients, ['acme']);
});

function accessServiceWith(rows) {
  const userRepository = new FakeUserRepository(rows);
  const userDirectory = new UserDirectory({ userRepository, schemaInitializer: noopSchemaInitializer });
  const service = new AccessService({ userRepository, userDirectory, schemaInitializer: noopSchemaInitializer });
  return { service, userRepository, userDirectory };
}

test('the last owner is protected without writing first', async () => {
  const { service, userRepository } = accessServiceWith([
    { id: 1, email: 'owner@example.com', role: 'owner' },
    { id: 2, email: 'member@example.com', role: 'member' }
  ]);

  await assert.rejects(service.update(1, { role: 'member' }, { actor: { email: 'owner@example.com' } }), ConflictError);
  const [owner] = await userRepository.list();
  assert.equal(owner.role, 'owner', 'the row was never touched, so no undo was needed');
});

test('adding a user normalizes the address and clears the lookup cache', async () => {
  const { service, userDirectory } = accessServiceWith([{ id: 1, email: 'owner@example.com', role: 'owner' }]);

  assert.equal(await userDirectory.lookup('new@example.com'), null); // caches the miss
  const created = await service.add({ email: '  New@Example.com ', name: ' New ', role: 'owner' });

  assert.equal(created.email, 'new@example.com');
  assert.equal(created.role, 'owner');
  const fresh = await userDirectory.lookup('new@example.com');
  assert.ok(fresh, 'the cached miss was invalidated by the write');
});

test('invalid addresses are rejected before touching storage', async () => {
  const { service, userRepository } = accessServiceWith([]);
  await assert.rejects(service.add({ email: 'oops' }), ValidationError);
  assert.equal(userRepository.rows.length, 0);
});

test('removing an unknown user is a 404', async () => {
  const { service } = accessServiceWith([{ id: 1, email: 'owner@example.com', role: 'owner' }]);
  await assert.rejects(service.remove(42, { actor: { email: 'owner@example.com' } }), NotFoundError);
});

test('an unreadable allow-list surfaces as a service outage with a hint', async () => {
  const directory = new UserDirectory({
    userRepository: { findByEmail: async () => { throw new Error('relation "app_users" does not exist'); } },
    schemaInitializer: noopSchemaInitializer
  });
  await assert.rejects(directory.lookup('x@example.com'), (error) => {
    assert.ok(error instanceof ServiceUnavailableError);
    assert.match(error.message, /npm run migrate/);
    return true;
  });
});

test('the directory caches lookups and only asks again after invalidation', async () => {
  let calls = 0;
  const directory = new UserDirectory({
    userRepository: {
      findByEmail: async (email) => {
        calls++;
        return { id: 1, email, role: 'member', is_active: true };
      }
    },
    schemaInitializer: noopSchemaInitializer
  });

  await directory.lookup('a@example.com');
  await directory.lookup('A@Example.com');
  assert.equal(calls, 1, 'the second lookup is served from cache, case-insensitively');

  directory.invalidate();
  await directory.lookup('a@example.com');
  assert.equal(calls, 2);
});

test('a dry-run import never reaches the importer', async () => {
  const importer = { import: async () => { throw new Error('must not be called'); } };
  const service = new ImportService({
    sheetParser: { parse: () => ({ rows: [{ title: 'A' }], unmapped: ['x'], problems: [], format: 'csv' }) },
    shootImporter: importer
  });

  const result = await service.execute({ content: 'a,b', dryRun: true });
  assert.equal(result.dryRun, true);
  assert.equal(result.count, 1);
  assert.deepEqual(result.unmapped, ['x']);
});

test('the import request accepts raw text and JSON envelopes', () => {
  assert.deepEqual(ImportService.readRequest('raw,csv'), { content: 'raw,csv', format: undefined, dryRun: false });
  assert.deepEqual(ImportService.readRequest({ content: 'a', format: 'csv', dryRun: 'true' }), {
    content: 'a', format: 'csv', dryRun: true
  });
  assert.equal(ImportService.readRequest({ text: 'b' }).content, 'b');
  // a non-string payload is re-serialized so the JSON reader can handle it
  assert.equal(ImportService.readRequest({ content: { rows: [{ a: 1 }] } }).content, '{"rows":[{"a":1}]}');
  assert.throws(() => ImportService.readRequest(undefined), ValidationError);
  assert.throws(() => ImportService.readRequest({ nothing: 'useful' }), /send raw file content/);
});
