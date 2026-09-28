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
const { DashboardService, validDateKey } = require('../../server/services/dashboard-service');
const { MetadataService } = require('../../server/services/metadata-service');
const { AccessService } = require('../../server/services/access-service');
const { UserDirectory } = require('../../server/services/user-directory');
const { ImportService } = require('../../server/services/import-service');
const { DataScopeService } = require('../../server/services/data-scope-service');
const { DataScope } = require('../../server/domain/data-scope');
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

  const { id } = await service.create(
    { title: 'Beach wedding', shoot_date: '2026-04-02', coordinator: 'New Person', fee: '15000' },
    DataScope.forSelf(1)
  );

  assert.ok(id);
  assert.deepEqual(database.statements, ['BEGIN', 'COMMIT']);
  assert.equal(coordinatorRepository.rows.length, 2);
  assert.equal(shootRepository.inserted[0].coordinator_id, 2);
  assert.equal(shootRepository.inserted[0].fee, 15000);
  assert.equal(shootRepository.inserted[0].coordinator, undefined, 'the name never reaches a column');
  assert.equal(shootRepository.inserted[0].owner_id, 1, 'a new shoot belongs to the creator');
});

test('a failed insert rolls back the coordinator upsert', async () => {
  const { service, database, shootRepository } = shootServiceWith();
  shootRepository.insert = async () => {
    throw new Error('constraint violation');
  };

  await assert.rejects(
    service.create({ title: 'x', shoot_date: '2026-04-02', coordinator: 'Temp Person' }, DataScope.forSelf(1)),
    /constraint violation/
  );
  assert.deepEqual(database.statements, ['BEGIN', 'ROLLBACK']);
});

test('the detail view combines the shoot with its ledger and media', async () => {
  const { service, paymentRepository, mediaRepository } = shootServiceWith([{ id: 7, title: 'Shoot', owner_id: 1 }]);
  await paymentRepository.insert({ shoot_id: 7, amount: 500 });
  await mediaRepository.insert({ shoot_id: 7, file_url: 'https://example/album' });

  const detail = await service.getDetail(7, DataScope.forSelf(1));
  assert.equal(detail.title, 'Shoot');
  assert.equal(detail.payments.length, 1);
  assert.equal(detail.media.length, 1);
});

test('missing shoots are reported as not found, not as an empty success', async () => {
  const { service } = shootServiceWith();
  await assert.rejects(service.getDetail(404, DataScope.forSelf(1)), NotFoundError);
  await assert.rejects(service.update(404, { title: 'x' }, DataScope.forSelf(1)), NotFoundError);
  await assert.rejects(service.remove(404, DataScope.forSelf(1)), NotFoundError);
});

test('an owner viewing another account reads and edits that account’s data', async () => {
  const { service, shootRepository } = shootServiceWith([
    { id: 1, title: 'Mine', owner_id: 1 },
    { id: 2, title: 'Theirs', owner_id: 2 }
  ]);
  const viewing = new DataScope({ selfId: 1, targetId: 2 });

  const detail = await service.getDetail(2, viewing);
  assert.equal(detail.title, 'Theirs', 'the viewed account’s record is visible');
  await assert.rejects(service.getDetail(1, viewing), NotFoundError, '…but not their own');

  // while viewing, the owner works on the viewed account's records
  await assert.doesNotReject(service.update(2, { title: 'Theirs, edited' }, viewing), 'the viewed shoot is editable');
  await assert.doesNotReject(service.create({ title: 'New for them', shoot_date: '2026-05-01' }, viewing));
  assert.equal(shootRepository.inserted[0].owner_id, 2, 'a new shoot filed under the viewed account');
  await assert.rejects(service.update(1, { title: 'ok' }, viewing), NotFoundError, '…own data is out of the write scope');
  await assert.rejects(service.remove(1, viewing), NotFoundError);
  await assert.doesNotReject(service.remove(2, viewing), 'the viewed shoot is deletable');
});

test('an owner not viewing edits only their own data', async () => {
  const { service } = shootServiceWith([
    { id: 1, title: 'Mine', owner_id: 1 },
    { id: 2, title: 'Theirs', owner_id: 2 }
  ]);
  const self = DataScope.forSelf(1);

  await assert.doesNotReject(service.update(1, { title: 'Mine, edited' }, self));
  await assert.rejects(service.update(2, { title: 'no' }, self), NotFoundError, 'another account is out of reach');
  await assert.rejects(service.remove(2, self), NotFoundError);
});

test('a member’s data is invisible to every other account, owner included', async () => {
  const { service } = shootServiceWith([{ id: 1, title: 'Member’s', owner_id: 2 }]);
  await assert.rejects(service.getDetail(1, DataScope.forSelf(1)), NotFoundError);
  await assert.rejects(service.update(1, { title: 'x' }, DataScope.forSelf(1)), NotFoundError);
  await assert.rejects(service.remove(1, DataScope.forSelf(1)), NotFoundError);
});

test('the list is scoped to the target account', async () => {
  const { service, shootRepository } = shootServiceWith([{ id: 1, title: 'S', owner_id: 5 }]);
  await service.list({ month: '2026-04' }, DataScope.forSelf(5));
  assert.equal(shootRepository.lastFilter.criteria.owner, '5', 'the owner id reaches the filter');
});

test('payments validate the amount and the parent shoot', async () => {
  const scope = DataScope.forSelf(1);
  const shootRepository = new FakeShootRepository([{ id: 1, title: 'Shoot', owner_id: 1 }]);
  const service = new PaymentService({ shootRepository, paymentRepository: new FakePaymentRepository() });

  await assert.rejects(service.record(1, {}, scope), /amount required/);
  await assert.rejects(service.record(1, { amount: 'plenty' }, scope), ValidationError);
  await assert.rejects(service.record(1, { amount: -5 }, scope), ValidationError);
  await assert.rejects(service.record(99, { amount: 10 }, scope), NotFoundError);

  const { id } = await service.record(1, { amount: '4000' }, scope);
  assert.ok(id);
});

test('a payment cannot be booked on another account’s shoot — except by an owner viewing it', async () => {
  const service = new PaymentService({
    shootRepository: new FakeShootRepository([{ id: 1, owner_id: 2 }]),
    paymentRepository: new FakePaymentRepository()
  });
  await assert.rejects(service.record(1, { amount: 10 }, DataScope.forSelf(1)), NotFoundError, 'own scope cannot touch it');
  await assert.doesNotReject(
    service.record(1, { amount: 10 }, new DataScope({ selfId: 1, targetId: 2 })),
    '…an owner looking at that account can settle its ledger'
  );
});

test('zero is a valid payment amount', async () => {
  const service = new PaymentService({
    shootRepository: new FakeShootRepository([{ id: 1, owner_id: 1 }]),
    paymentRepository: new FakePaymentRepository()
  });
  await assert.doesNotReject(service.record(1, { amount: 0 }, DataScope.forSelf(1)));
});

test('media requires a URL and an existing shoot', async () => {
  const service = new MediaService({
    shootRepository: new FakeShootRepository([{ id: 1, owner_id: 1 }]),
    mediaRepository: new FakeMediaRepository()
  });
  const scope = DataScope.forSelf(1);
  await assert.rejects(service.attach(1, { caption: 'no url' }, scope), /file_url required/);
  await assert.rejects(service.attach(2, { file_url: 'https://x' }, scope), NotFoundError);
  assert.ok((await service.attach(1, { file_url: ' https://x ' }, scope)).id);
});

test('a media link cannot attach to another account’s shoot — except by an owner viewing it', async () => {
  const service = new MediaService({
    shootRepository: new FakeShootRepository([{ id: 1, owner_id: 2 }]),
    mediaRepository: new FakeMediaRepository()
  });
  await assert.rejects(service.attach(1, { file_url: 'https://x' }, DataScope.forSelf(1)), NotFoundError, 'own scope cannot touch it');
  await assert.doesNotReject(
    service.attach(1, { file_url: 'https://x' }, new DataScope({ selfId: 1, targetId: 2 })),
    '…an owner looking at that account can add its media'
  );
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

test('the dashboard passes one identical, owner-scoped filter to every aggregate', async () => {
  const seen = [];
  const seenDays = [];
  const stub = (value) => async (filter, _limit, today) => {
    seen.push(filter);
    seenDays.push(today);
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

  const result = await service.summarize({ month: '2026-04', today: '2026-04-02', bogus: 'ignored' }, DataScope.forSelf(5));
  assert.deepEqual(Object.keys(result), ['kpi', 'monthly', 'byCoordinator', 'byType', 'byStatus', 'upcoming', 'attention']);
  assert.equal(seen.length, 7);
  assert.ok(seen.every((filter) => filter === seen[0]), 'the same filter instance is reused');
  assert.deepEqual(seen[0].criteria, { month: '2026-04', owner: '5' });
  assert.deepEqual(seenDays, [undefined, undefined, undefined, undefined, undefined, '2026-04-02', '2026-04-02']);
  assert.equal(validDateKey('2026-09-29'), '2026-09-29');
  assert.equal(validDateKey('2026-02-30'), undefined, 'invalid calendar days are discarded');
});

test('metadata offers the viewed account’s own values, coordinators and titles', async () => {
  const seenOwners = [];
  const call = (result) => async (ownerId) => (seenOwners.push(ownerId), result);
  const service = new MetadataService({
    metadataRepository: {
      distinctCoordinators: call([{ id: 7, name: 'Riya Saha' }]),
      distinctClients: call(['acme']),
      distinctTypes: call(['wedding']),
      months: call(['2026-04']),
      pastTitles: call(['Amritsar wedding', 'Mumbai product shoot']),
      titleSuggestions: call([
        { title: 'Amritsar wedding', fee: 25000, coordinator: 'Riya Saha' },
        { title: 'Mumbai product shoot', fee: 12000, coordinator: null }
      ])
    }
  });

  // an owner viewing account 9 gets account 9’s reference data
  const meta = await service.describe(new DataScope({ selfId: 1, targetId: 9 }));
  assert.deepEqual(meta.statuses, ['planned', 'completed']);
  assert.deepEqual(meta.coordinators, [{ id: 7, name: 'Riya Saha' }], 'coordinators come from the account’s own shoots');
  assert.deepEqual(meta.clients, ['acme']);
  assert.deepEqual(meta.titles, ['Amritsar wedding', 'Mumbai product shoot'], 'past titles feed the title suggestions');
  assert.deepEqual(meta.titleSuggestions[0], { title: 'Amritsar wedding', fee: 25000, coordinator: 'Riya Saha' });
  assert.ok(seenOwners.length === 6 && seenOwners.every((owner) => owner === 9), 'every list is scoped to the viewed account');
});

/* ---------------- data scope ---------------- */

function scopeServiceWith(accounts) {
  const directory = {
    lookup: async (email) =>
      accounts.find((account) => String(account.email).toLowerCase() === String(email).toLowerCase()) || null
  };
  return new DataScopeService({ userDirectory: directory });
}

const OWNER = { id: 1, email: 'owner@example.com', role: 'owner' };
const MEMBER = { id: 2, email: 'member@example.com', role: 'member' };
const OTHER = { id: 3, email: 'other@example.com', role: 'member', is_active: false };

test('a member always scopes to themselves, whatever the request carries', async () => {
  const service = scopeServiceWith([MEMBER]);
  const scope = await service.resolve(MEMBER, 'owner@example.com');
  assert.deepEqual({ selfId: scope.selfId, targetId: scope.targetId }, { selfId: 2, targetId: 2 });
  assert.equal(scope.isViewingOther, false);
});

test('an owner without a choice scopes to themselves', async () => {
  const service = scopeServiceWith([OWNER]);
  const scope = await service.resolve(OWNER, undefined);
  assert.equal(scope.targetId, 1);
});

test('an owner can scope to another account — deactivated ones included', async () => {
  const service = scopeServiceWith([OWNER, OTHER]);
  const scope = await service.resolve(OWNER, 'OTHER@example.com');
  assert.equal(scope.selfId, 1);
  assert.equal(scope.targetId, 3, 'reads follow the choice, case-insensitively');
  assert.equal(scope.isViewingOther, true);
  assert.equal(scope.writeId, 3, '…and so do writes: the owner edits the data they are looking at');
});

test('writes stay on the signed-in account unless an owner is viewing', async () => {
  assert.equal(DataScope.forSelf(7).writeId, 7);
  assert.equal(new DataScope({ selfId: 1, targetId: 2 }).writeId, 2, 'viewing → writes follow the target');
  const scope = new DataScope({ selfId: 2, targetId: 2 });
  assert.equal(scope.writeId, 2, 'a member is always self/self');
});

test('an owner cannot scope to an account that is not in the app', async () => {
  const service = scopeServiceWith([OWNER]);
  await assert.rejects(service.resolve(OWNER, 'ghost@example.com'), ValidationError);
});

test('asking to view oneself is the same as not asking', async () => {
  const service = scopeServiceWith([OWNER]);
  const scope = await service.resolve(OWNER, 'Owner@Example.com ');
  assert.equal(scope.targetId, 1);
  assert.equal(scope.isViewingOther, false);
});

function accessServiceWith(rows) {
  const userRepository = new FakeUserRepository(rows);
  const userDirectory = new UserDirectory({ userRepository, schemaInitializer: noopSchemaInitializer });
  const service = new AccessService({ userRepository, userDirectory, schemaInitializer: noopSchemaInitializer });
  return { service, userRepository, userDirectory };
}

test('an owner may change another account’s role, both directions', async () => {
  const { service, userRepository } = accessServiceWith([
    { id: 1, email: 'owner@example.com', role: 'owner', is_active: true },
    { id: 2, email: 'second@example.com', role: 'owner', is_active: true },
    { id: 3, email: 'member@example.com', role: 'member', is_active: true }
  ]);

  // promote a member, with another active owner around
  const promoted = await service.update(3, { role: 'owner' }, { actor: { email: 'owner@example.com' } });
  assert.equal(promoted.role, 'owner', 'the promotion is written');

  // …and demote an owner back down
  const demoted = await service.update(2, { role: 'member' }, { actor: { email: 'owner@example.com' } });
  assert.equal(demoted.role, 'member', 'the demotion is written');

  // nobody changes their own role
  await assert.rejects(
    service.update(1, { role: 'member' }, { actor: { email: 'owner@example.com' } }),
    /cannot change your own role/
  );
  // an unknown role is a validation error
  await assert.rejects(
    service.update(3, { role: 'superuser' }, { actor: { email: 'owner@example.com' } }),
    /role must be one of/
  );

  const rows = await userRepository.list();
  assert.equal(rows.find((row) => row.id === 1).role, 'owner', 'the self-patch never reached the row');
  assert.equal(rows.find((row) => row.id === 3).role, 'owner');
});

test('demoting the last active owner is refused without writing', async () => {
  const { service, userRepository } = accessServiceWith([
    { id: 1, email: 'owner@example.com', role: 'owner', is_active: true },
    { id: 2, email: 'member@example.com', role: 'member', is_active: true }
  ]);

  await assert.rejects(
    service.update(1, { role: 'member' }, { actor: { email: 'member@example.com' } }),
    /At least one active owner is required/
  );
  const rows = await userRepository.list();
  assert.equal(rows.find((row) => row.id === 1).role, 'owner', 'the row was never touched');
});

test('deactivating the last owner is refused without writing first', async () => {
  const { service } = accessServiceWith([
    { id: 1, email: 'owner@example.com', role: 'owner' },
    { id: 2, email: 'member@example.com', role: 'member' }
  ]);

  await assert.rejects(
    service.update(1, { is_active: false }, { actor: { email: 'owner@example.com' } }),
    /At least one active owner is required/
  );
});

test('adding a user normalizes the address, arrives as member and clears the lookup cache', async () => {
  const { service, userDirectory } = accessServiceWith([{ id: 1, email: 'owner@example.com', role: 'owner' }]);

  assert.equal(await userDirectory.lookup('new@example.com'), null); // caches the miss
  const created = await service.add({ email: '  New@Example.com ', name: ' New ', role: 'owner' });

  assert.equal(created.email, 'new@example.com');
  assert.equal(created.role, 'member', 'a sent role is ignored — people join as members');
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
