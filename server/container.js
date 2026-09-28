'use strict';

/**
 * @module server/container
 *
 * Composition root: the single place where concrete implementations are chosen
 * and wired together.
 *
 * Every other module receives its collaborators through its constructor and
 * depends on the *shape* of them (a database that can `query`, a repository
 * that can `findById`), never on a module-level singleton. That is what makes
 * the code unit-testable with fakes and lets an implementation be swapped
 * without a ripple.
 */

const { createLogger } = require('./core/logger');
const { PostgresDatabase } = require('./persistence/postgres-database');
const { SchemaInitializer } = require('./persistence/schema-initializer');

const { ShootRepository } = require('./repositories/shoot-repository');
const { PaymentRepository } = require('./repositories/payment-repository');
const { MediaRepository } = require('./repositories/media-repository');
const { CoordinatorRepository } = require('./repositories/coordinator-repository');
const { AnalyticsRepository } = require('./repositories/analytics-repository');
const { MetadataRepository } = require('./repositories/metadata-repository');
const { UserRepository } = require('./repositories/user-repository');

const { SheetParser } = require('./import/sheet-parser');

const { ShootService } = require('./services/shoot-service');
const { PaymentService } = require('./services/payment-service');
const { MediaService } = require('./services/media-service');
const { CoordinatorService } = require('./services/coordinator-service');
const { DashboardService } = require('./services/dashboard-service');
const { MetadataService } = require('./services/metadata-service');
const { HealthService } = require('./services/health-service');
const { UserDirectory } = require('./services/user-directory');
const { AccessService } = require('./services/access-service');
const { SessionService } = require('./services/session-service');
const { GoogleIdentityVerifier } = require('./services/google-identity-verifier');
const { AuthenticationService } = require('./services/authentication-service');
const { DataScopeService } = require('./services/data-scope-service');
const { ShootImporter } = require('./services/shoot-importer');
const { ImportService } = require('./services/import-service');

/**
 * @param {{ config: object, logger?: object, database?: object }} deps
 *        `database` can be supplied to run against an existing pool or a fake.
 */
function createContainer({ config, logger, database }) {
  const log = logger || createLogger({ level: config.logLevel });

  const db =
    database ||
    new PostgresDatabase({
      url: config.database.url,
      connectionTimeoutMillis: config.database.connectionTimeoutMillis,
      idleTimeoutMillis: config.database.idleTimeoutMillis,
      maxClients: config.database.maxClients,
      healthCheckTimeoutMs: config.database.healthCheckTimeoutMs,
      logger: log.child('db')
    });

  const schemaInitializer = new SchemaInitializer({ database: db, logger: log.child('schema') });

  const repositories = {
    shootRepository: new ShootRepository({ database: db, maxRows: config.limits.shootListMaxRows }),
    paymentRepository: new PaymentRepository({ database: db }),
    mediaRepository: new MediaRepository({ database: db }),
    coordinatorRepository: new CoordinatorRepository({ database: db }),
    analyticsRepository: new AnalyticsRepository({ database: db }),
    metadataRepository: new MetadataRepository({ database: db }),
    userRepository: new UserRepository({ database: db })
  };

  const userDirectory = new UserDirectory({
    userRepository: repositories.userRepository,
    schemaInitializer,
    cacheTtlMs: config.auth.allowlistCacheMs
  });

  const sessionService = new SessionService({
    secret: config.auth.sessionSecret,
    cookieName: config.auth.sessionCookieName,
    ttlSeconds: config.auth.sessionTtlSeconds,
    isProduction: config.isProduction
  });

  const identityVerifier = new GoogleIdentityVerifier({
    clientId: config.auth.googleClientId,
    certsUrl: config.auth.googleCertsUrl
  });

  const sheetParser = new SheetParser();
  const shootImporter = new ShootImporter({ database: db, ...repositories });

  const accessService = new AccessService({
    userRepository: repositories.userRepository,
    userDirectory,
    schemaInitializer
  });
  const authenticationService = new AuthenticationService({
    identityVerifier,
    userDirectory,
    accessService,
    sessionService,
    googleClientId: config.auth.googleClientId,
    devSignInEmail: config.auth.devSignInEmail,
    logger: log.child('auth')
  });

  const services = {
    shootService: new ShootService({ database: db, ...repositories }),
    paymentService: new PaymentService(repositories),
    mediaService: new MediaService(repositories),
    coordinatorService: new CoordinatorService(repositories),
    dashboardService: new DashboardService(repositories),
    metadataService: new MetadataService(repositories),
    healthService: new HealthService({ database: db, timeoutMs: config.database.healthCheckTimeoutMs }),
    userDirectory,
    accessService,
    dataScopeService: new DataScopeService({ userDirectory }),
    sessionService,
    identityVerifier,
    authenticationService,
    shootImporter,
    importService: new ImportService({ sheetParser, shootImporter })
  };

  return {
    config,
    logger: log,
    database: db,
    schemaInitializer,
    sheetParser,
    ...repositories,
    ...services,
    /** Release infrastructure held by the container. */
    close: () => db.close()
  };
}

module.exports = { createContainer };
