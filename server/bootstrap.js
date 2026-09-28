'use strict';

const { loadConfig, loadEnvFile } = require('./config');
const { createLogger } = require('./core/logger');
const { createContainer } = require('./container');

/**
 * Build the runtime every entry point needs: `.env` → config → logger →
 * container.
 *
 * The web server, the migration CLI, the importer and the demo seeder all start
 * the same way, so none of them reads `process.env` or constructs a pool by
 * hand.
 *
 * @param {{ env?: NodeJS.ProcessEnv, logLevel?: string, skipEnvFile?: boolean,
 *           timestamps?: boolean }} [options]
 *        CLIs pass `timestamps: false` so their output stays readable.
 */
function createRuntime(options = {}) {
  const env = options.skipEnvFile ? options.env || process.env : loadEnvFile();
  const config = loadConfig(options.env || env);
  const logger = createLogger({
    level: options.logLevel || config.logLevel,
    timestamps: options.timestamps !== false
  });
  const container = createContainer({ config, logger });
  return { config, logger, container };
}

module.exports = { createRuntime };
