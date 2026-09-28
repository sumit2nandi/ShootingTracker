'use strict';

/**
 * Process entry point.
 *
 * Its whole job: build the runtime, start listening and shut down cleanly.
 * Application behaviour lives in `app.js` (HTTP wiring) and the service layer,
 * which is why this file barely changes and can be tested by simply not
 * running it.
 */

const { createRuntime } = require('./bootstrap');
const { createApp } = require('./app');

function start() {
  const { config, logger, container } = createRuntime();

  if (!config.auth.sessionSecretProvided) {
    logger.warn('[auth] SESSION_SECRET is unset; sessions will reset when the server restarts');
  }
  if (config.auth.devSignInEmail) {
    logger.warn(`[auth] DEV_SIGN_IN_EMAIL is set — every request is treated as ${config.auth.devSignInEmail}. Never use this in production.`);
  }
  if (!config.database.url) {
    logger.warn('[db] DATABASE_URL is unset; the app will start but every query will fail');
  }

  const app = createApp(container);
  const server = app.listen(config.port, '0.0.0.0', () => {
    logger.info(`ShootingTracker listening on http://0.0.0.0:${config.port}`);
  });

  installShutdownHandlers({ server, container, logger });
  return { app, server, container };
}

/**
 * Stop accepting connections, drain the pool, then exit — so a deploy or a
 * Ctrl+C never severs an in-flight transaction.
 */
function installShutdownHandlers({ server, container, logger }) {
  let shuttingDown = false;

  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`received ${signal}, shutting down`);
    const forceExit = setTimeout(() => process.exit(1), 10_000);
    forceExit.unref();
    try {
      await new Promise((resolve) => server.close(resolve));
      await container.close();
      logger.info('shutdown complete');
      process.exit(0);
    } catch (error) {
      logger.error('shutdown failed:', error.message);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandled promise rejection:', reason instanceof Error ? reason.stack : reason);
  });
  process.on('uncaughtException', (error) => {
    logger.error('uncaught exception:', error.stack || error.message);
    shutdown('uncaughtException');
  });
}

if (require.main === module) start();

module.exports = { start };
