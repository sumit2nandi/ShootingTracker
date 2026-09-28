'use strict';

// Applies server/schema.sql to the configured database.
// Usage: node server/migrate.js

const { createRuntime } = require('./bootstrap');

async function migrate() {
  const { logger, container } = createRuntime({ timestamps: false });
  try {
    await container.schemaInitializer.apply();
    const tables = await container.database.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1"
    );
    logger.info('Schema applied. Tables:', tables.rows.map((row) => row.table_name).join(', '));
  } catch (error) {
    logger.error('Migration failed:', error.message);
    process.exitCode = 1;
  } finally {
    await container.close();
  }
}

if (require.main === module) migrate();

module.exports = { migrate };
