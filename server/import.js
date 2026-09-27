'use strict';
// CLI importer.
//   node server/import.js <file.html|file.csv|file.json> [--dry-run] [--emit-sql out.sql]
//
//   --dry-run     Parse only; print a summary and sample rows, touch no DB.
//   --emit-sql    Write a standalone .sql (safe for the Aiven web console).
//   (default)     Insert into the configured DATABASE_URL.
const fs = require('fs');
const path = require('path');
const { parseSheet, detectFormat } = require('./parse');
const { importRows, emitSql } = require('./import-core');

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const dryRun = args.includes('--dry-run');
const emitArg = args.find((a) => a === '--emit-sql');
const outArg = args.find((a, i) => !a.startsWith('--') && args[i - 1] === '--emit-sql');

if (!file) {
  console.log('Usage: node server/import.js <file.html|csv|json> [--dry-run] [--emit-sql out.sql]');
  process.exit(1);
}
if (!fs.existsSync(file)) {
  console.error('File not found:', file);
  process.exit(1);
}

const text = fs.readFileSync(file, 'utf8');
const format = detectFormat(text);
const { rows, unmapped, problems } = parseSheet(text, format);

console.log(`Format detected : ${format}`);
console.log(`Rows parsed     : ${rows.length}`);
console.log(`Unmapped cols   : ${unmapped.length ? unmapped.join(', ') : '(none)'}`);
if (problems.length) {
  console.log(`Skipped rows    : ${problems.length}`);
  for (const p of problems.slice(0, 10)) console.log(`  row ${p.row}: ${p.reason}`);
}
console.log('\nSample (first 5):');
for (const r of rows.slice(0, 5)) {
  console.log(
    `  ${r.shoot_date} | ${r.title.slice(0, 40)} | client=${r.client_name || '-'} | ` +
    `coord=${r.coordinator || '-'} | fee=${r.fee} | paid=${(r.payments || []).reduce((a, p) => a + p.amount, 0)} | ${r.status}`
  );
}

if (dryRun || emitArg) {
  if (emitArg && outArg) {
    fs.writeFileSync(outArg, emitSql(rows));
    console.log(`\nWrote ${outArg} (${fs.statSync(outArg).size} bytes) — apply it in the Aiven console.`);
  } else if (emitArg) {
    console.log('\nSQL output:');
    console.log(emitSql(rows));
  } else {
    console.log('\nDry run complete — database untouched.');
  }
  process.exit(0);
}

(async () => {
  const result = await importRows(rows);
  console.log('\nImport result:');
  console.log(`  inserted shoots : ${result.inserted}`);
  console.log(`  skipped (dupes) : ${result.skipped}`);
  console.log(`  payments added  : ${result.payments}`);
  console.log(`  coordinators    : ${result.coordinators.join(', ') || '(none)'}`);
  if (result.errors.length) {
    console.log(`  errors          : ${result.errors.length}`);
    for (const e of result.errors.slice(0, 10)) console.log(`    ${e.title} — ${e.error}`);
  }
  const { pool } = require('./db');
  await pool.end();
})().catch((e) => {
  console.error('Import failed:', e.message);
  process.exit(1);
});
