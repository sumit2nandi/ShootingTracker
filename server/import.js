'use strict';

// CLI importer.
//   node server/import.js <file.html|file.csv|file.json> [--dry-run] [--emit-sql out.sql]
//
//   --dry-run     Parse only; print a summary and sample rows, touch no DB.
//   --emit-sql    Write a standalone .sql (safe for the Aiven web console).
//   (default)     Insert into the configured DATABASE_URL.

const fs = require('fs');
const { createRuntime } = require('./bootstrap');
const { emitSql } = require('./import/sql-emitter');

const USAGE = 'Usage: node server/import.js <file.html|csv|json> [--dry-run] [--emit-sql out.sql]';

/**
 * Pure argument parsing, so the CLI's contract is unit-testable.
 *
 * @param {string[]} argv
 * @returns {{ file: string|null, dryRun: boolean, emitSql: boolean, sqlOut: string|null }}
 */
function parseArguments(argv) {
  const positional = argv.filter((arg, index) => !arg.startsWith('--') && argv[index - 1] !== '--emit-sql');
  const emitIndex = argv.indexOf('--emit-sql');
  const next = emitIndex >= 0 ? argv[emitIndex + 1] : undefined;
  return {
    file: positional[0] || null,
    dryRun: argv.includes('--dry-run'),
    emitSql: emitIndex >= 0,
    sqlOut: next && !next.startsWith('--') ? next : null
  };
}

function printSummary({ format, rows, unmapped, problems }, logger) {
  logger.info(`Format detected : ${format}`);
  logger.info(`Rows parsed     : ${rows.length}`);
  logger.info(`Unmapped cols   : ${unmapped.length ? unmapped.join(', ') : '(none)'}`);
  if (problems.length) {
    logger.info(`Skipped rows    : ${problems.length}`);
    for (const problem of problems.slice(0, 10)) logger.info(`  row ${problem.row}: ${problem.reason}`);
  }
  logger.info('\nSample (first 5):');
  for (const row of rows.slice(0, 5)) {
    const paid = (row.payments || []).reduce((total, payment) => total + payment.amount, 0);
    logger.info(
      `  ${row.shoot_date} | ${row.title.slice(0, 40)} | client=${row.client_name || '-'} | ` +
        `coord=${row.coordinator || '-'} | fee=${row.fee} | paid=${paid} | ${row.status}`
    );
  }
}

async function run(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const { logger, container } = createRuntime({ timestamps: false });

  if (!options.file) {
    logger.info(USAGE);
    process.exitCode = 1;
    return container.close();
  }
  if (!fs.existsSync(options.file)) {
    logger.error('File not found:', options.file);
    process.exitCode = 1;
    return container.close();
  }

  const parsed = container.sheetParser.parse(fs.readFileSync(options.file, 'utf8'));
  printSummary(parsed, logger);

  try {
    if (options.emitSql) {
      const sql = emitSql(parsed.rows);
      if (options.sqlOut) {
        fs.writeFileSync(options.sqlOut, sql);
        logger.info(`\nWrote ${options.sqlOut} (${fs.statSync(options.sqlOut).size} bytes) — apply it in the Aiven console.`);
      } else {
        logger.info('\nSQL output:');
        logger.info(sql);
      }
      return;
    }
    if (options.dryRun) {
      logger.info('\nDry run complete — database untouched.');
      return;
    }

    const result = await container.shootImporter.import(parsed.rows);
    logger.info('\nImport result:');
    logger.info(`  inserted shoots : ${result.inserted}`);
    logger.info(`  skipped (dupes) : ${result.skipped}`);
    logger.info(`  payments added  : ${result.payments}`);
    logger.info(`  coordinators    : ${result.coordinators.join(', ') || '(none)'}`);
    if (result.errors.length) {
      logger.info(`  errors          : ${result.errors.length}`);
      for (const error of result.errors.slice(0, 10)) logger.info(`    ${error.title} — ${error.error}`);
    }
  } finally {
    await container.close();
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error('Import failed:', error.message);
    process.exit(1);
  });
}

module.exports = { run, parseArguments, USAGE };
