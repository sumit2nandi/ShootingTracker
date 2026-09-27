'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { detectFormat } = require('../../server/import/format-detector');
const { CsvTableReader, detectDelimiter } = require('../../server/import/readers/csv-reader');
const { HtmlTableReader } = require('../../server/import/readers/html-table-reader');
const { JsonTableReader } = require('../../server/import/readers/json-reader');
const { TableReaderRegistry } = require('../../server/import/readers');
const { normalizeHeader, mapHeaders } = require('../../server/import/header-mapper');
const { parseDate, parseTime, parseMoney, parseStatus, parsePaid } = require('../../server/import/values');
const { ShootRowMapper } = require('../../server/import/shoot-row-mapper');
const { SheetParser } = require('../../server/import/sheet-parser');
const { emitSql } = require('../../server/import/sql-emitter');

const SAMPLE_SHEET = path.join(__dirname, '..', '..', 'data', 'sample-sheet.html');

test('formats are detected from content, not from a file name', () => {
  assert.equal(detectFormat('<html><table><tr><td>x</td></tr></table></html>'), 'html');
  assert.equal(detectFormat('  \uFEFF[{"a":1}]'), 'json');
  assert.equal(detectFormat('a,b,c\n1,2,3'), 'csv');
  assert.equal(detectFormat(''), 'csv');
});

test('the reader registry is extensible and falls back to CSV', () => {
  const registry = TableReaderRegistry.createDefault();
  assert.deepEqual(registry.formats.sort(), ['csv', 'html', 'json']);
  assert.ok(registry.resolve('html') instanceof HtmlTableReader);
  assert.ok(registry.resolve('unknown-format') instanceof CsvTableReader);

  class MarkdownReader {
    get format() { return 'markdown'; }
    read() { return { headers: ['a'], data: [['1']] }; }
  }
  registry.register(new MarkdownReader());
  assert.deepEqual(registry.resolve('markdown').read(''), { headers: ['a'], data: [['1']] });
});

test('CSV quoting, embedded newlines and entities are handled', () => {
  const { headers, data } = new CsvTableReader().read(
    'Date,Client Name,Fee\n"02/04/2026","Ananya &amp; Vikram","45,000"\n05/04/2026,"He said ""hi""",100\n'
  );
  assert.deepEqual(headers, ['date', 'client name', 'fee']);
  assert.deepEqual(data[0], ['02/04/2026', 'Ananya & Vikram', '45,000']);
  assert.deepEqual(data[1], ['05/04/2026', 'He said "hi"', '100']);
});

test('delimiters other than comma are detected', () => {
  assert.equal(detectDelimiter('a\tb\tc'), '\t');
  assert.equal(detectDelimiter('a;b;c'), ';');
  assert.equal(detectDelimiter('single'), ',');
  assert.deepEqual(new CsvTableReader().read('a;b\n1;2').data, [['1', '2']]);
});

test('the HTML reader picks the largest table and normalizes headers', () => {
  const { headers, data } = new HtmlTableReader().read(`
    <table><tr><td>chrome</td></tr></table>
    <table>
      <tr><th>Date</th><th>Fee (Rs)</th></tr>
      <tr><td>02/04/2026</td><td>45000</td></tr>
      <tr><td></td><td></td></tr>
      <tr><td>03/04/2026</td><td>1000</td></tr>
    </table>`);
  assert.deepEqual(headers, ['date', 'fee']);
  assert.equal(data.length, 2, 'blank rows are dropped');
});

test('the JSON reader unions keys across objects', () => {
  const { headers, data } = new JsonTableReader().read('[{"date":"2026-04-02"},{"date":"2026-04-03","fee":100}]');
  assert.deepEqual(headers, ['date', 'fee']);
  assert.deepEqual(data, [['2026-04-02', ''], ['2026-04-03', '100']]);
  assert.deepEqual(new JsonTableReader().read('not json'), { headers: [], data: [] });
});

test('headers are normalized before matching', () => {
  assert.equal(normalizeHeader('  Fee (Rs.) '), 'fee');
  assert.equal(normalizeHeader('Co-Ordinator'), 'co ordinator');
});

test('header mapping is first-match-wins and records leftovers', () => {
  const { mapping, unmapped } = mapHeaders(['date', 'client', 'fee', 'wedding planner', 'remarks']);
  assert.deepEqual(mapping, { shoot_date: 0, client_name: 1, fee: 2, notes: 4 });
  assert.deepEqual(unmapped, ['wedding planner']);
});

test('dates in every format the sheets use', () => {
  assert.equal(parseDate('2026-04-02'), '2026-04-02');
  assert.equal(parseDate('02/04/2026'), '2026-04-02', 'day first by default');
  assert.equal(parseDate('12/31/2026'), '2026-12-31', 'US order when the month slot cannot be a month');
  assert.equal(parseDate('2-4-26'), '2026-04-02');
  assert.equal(parseDate('12 Jan 2025'), '2025-01-12');
  assert.equal(parseDate('Jan 12 2025'), '2025-01-12');
  assert.equal(parseDate('31/02/2026'), null, 'impossible days are rejected');
  assert.equal(parseDate('sometime next week'), null);
  assert.equal(parseDate(''), null);
});

test('times, money and statuses', () => {
  assert.equal(parseTime('10:30'), '10:30:00');
  assert.equal(parseTime('9 pm'), '21:00:00');
  assert.equal(parseTime('noon'), null);

  assert.equal(parseMoney('₹ 45,000.50'), 45000.5);
  assert.equal(parseMoney('n/a'), null);

  assert.equal(parseStatus('Cancelled'), 'completed');
  assert.equal(parseStatus('Postponed'), 'planned');
  assert.equal(parseStatus('Confirmed'), 'planned');
  assert.equal(parseStatus('anything else'), null);
});

test('the paid column is interpreted against the fee', () => {
  assert.equal(parsePaid('Paid', 45000), 45000);
  assert.equal(parsePaid('50%', 18000), 9000);
  assert.equal(parsePaid('7500', 15000), 7500);
  assert.equal(parsePaid('No', 35000), 0);
  assert.equal(parsePaid('Pending', 25000), 0);
  assert.equal(parsePaid('', 25000), null, 'unknown, so the caller decides');
});

test('rows without a usable date are reported, not silently dropped', () => {
  const { rows, problems } = new ShootRowMapper().map({
    headers: ['date', 'title'],
    data: [['nope', 'A'], ['2026-04-02', 'B']]
  });
  assert.equal(rows.length, 1);
  assert.deepEqual(problems, [{ row: 2, reason: 'no parsable date in column "date"' }]);
});

test('a missing title falls back to client and type', () => {
  const [row] = new ShootRowMapper().map({
    headers: ['date', 'client', 'type'],
    data: [['2026-04-02', 'Acme', 'wedding']]
  }).rows;
  assert.equal(row.title, 'Acme – wedding');

  const [bare] = new ShootRowMapper().map({ headers: ['date'], data: [['2026-04-02']] }).rows;
  assert.equal(bare.title, 'Shoot on 2026-04-02');
});

test('unmapped columns are preserved in extra', () => {
  const [row] = new ShootRowMapper().map({
    headers: ['date', 'drone pilot', 'empty column'],
    data: [['2026-04-02', 'Sam', '   ']]
  }).rows;
  assert.deepEqual(row.extra, { 'drone pilot': 'Sam' });
});

test('the dedupe hash is stable and depends only on identity fields', () => {
  const mapper = new ShootRowMapper();
  const of = (data) => mapper.map({ headers: ['date', 'title', 'client', 'fee', 'venue'], data }).rows[0].dedupe_hash;

  assert.equal(of([['2026-04-02', 'Wedding', 'Acme', '100', 'Hall A']]), of([['2026-04-02', 'Wedding', 'Acme', '100', 'Hall B']]));
  assert.notEqual(of([['2026-04-02', 'Wedding', 'Acme', '100', '']]), of([['2026-04-03', 'Wedding', 'Acme', '100', '']]));
});

test('an end date before the start date is clamped', () => {
  const [row] = new ShootRowMapper().map({
    headers: ['date', 'end date'],
    data: [['2026-04-10', '2026-04-01']]
  }).rows;
  assert.equal(row.end_date, '2026-04-10');
});

test('the shipped sample sheet parses end to end', () => {
  const parsed = new SheetParser().parse(fs.readFileSync(SAMPLE_SHEET, 'utf8'));

  assert.equal(parsed.format, 'html');
  assert.equal(parsed.rows.length, 8);
  assert.deepEqual(parsed.problems, []);

  const [first] = parsed.rows;
  assert.equal(first.shoot_date, '2026-04-02');
  assert.equal(first.client_name, 'Ananya & Vikram');
  assert.equal(first.coordinator, 'Riya Saha');
  assert.equal(first.fee, 45000);
  assert.equal(first.status, 'completed');
  assert.deepEqual(first.payments, [{ amount: 45000, method: null, note: 'from import', paid_on: '2026-04-02' }]);
  assert.equal(first.notes, '4 days, 2 venues', '"Remarks" maps onto notes');
  assert.deepEqual(first.extra, {}, 'every column in this sheet is recognised');

  const byClient = Object.fromEntries(parsed.rows.map((row) => [row.client_name, row]));
  assert.equal(byClient['Sanket Jewellers'].payments[0].amount, 9000, '50% of 18000');
  assert.equal(byClient['Rohit Industries'].payments.length, 0, '"Pending" means nothing collected');
  assert.equal(byClient['Ishita & Arindam'].status, 'planned', '"Postponed" is still to come');
  assert.equal(byClient['Lakshmi Sarees'].status, 'completed', '"Cancelled" is closed out');
  assert.equal(byClient['Kunal & Ritu'].shoot_date, '2026-04-21', '"21 Apr 2026" style date');
});

test('parsing the same sheet twice yields identical dedupe hashes (idempotent re-import)', () => {
  const content = fs.readFileSync(SAMPLE_SHEET, 'utf8');
  const first = new SheetParser().parse(content).rows.map((row) => row.dedupe_hash);
  const second = new SheetParser().parse(content).rows.map((row) => row.dedupe_hash);
  assert.deepEqual(first, second);
  assert.equal(new Set(first).size, first.length, 'no collisions within one sheet');
});

test('an empty sheet reports a problem instead of throwing', () => {
  const parsed = new SheetParser().parse('');
  assert.deepEqual(parsed.rows, []);
  assert.equal(parsed.problems[0].reason, 'no table rows found');
});

test('emitted SQL is escaped and re-runnable', () => {
  const sql = emitSql([
    {
      title: "O'Brien wedding",
      client_name: 'Acme',
      shoot_date: '2026-04-02',
      fee: 1000,
      status: 'completed',
      coordinator: 'Riya',
      extra: { note: 'x' },
      dedupe_hash: 'abc',
      payments: [{ amount: 500, paid_on: '2026-04-02', method: null, note: 'from import' }]
    }
  ]);

  assert.match(sql, /BEGIN;/);
  assert.match(sql, /COMMIT;/);
  assert.match(sql, /O''Brien wedding/, 'quotes are escaped');
  assert.match(sql, /ON CONFLICT \(dedupe_hash\) DO NOTHING/);
  assert.match(sql, /ON CONFLICT \(lower\(name\)\) DO UPDATE/);
  assert.match(sql, /NOT EXISTS \(SELECT 1 FROM payments/);
});
