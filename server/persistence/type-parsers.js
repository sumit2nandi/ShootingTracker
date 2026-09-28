'use strict';

const pg = require('pg');

const DATE_OID = 1082;
const TIME_OID = 1083;
const TIMESTAMP_OID = 1114;
const TIMESTAMPTZ_OID = 1184;

let applied = false;

/**
 * Serialize DATE / TIME / TIMESTAMP columns as plain strings instead of JS
 * `Date` objects, so the JSON API returns "2026-04-02" / "10:00:00" rather than
 * a value shifted into the process time zone.
 *
 * Global driver state, so it is applied exactly once and only from the
 * persistence layer.
 */
function applyDateTypeParsers(driver = pg) {
  if (applied) return;
  const identity = (value) => value;
  driver.types.setTypeParser(DATE_OID, identity);
  driver.types.setTypeParser(TIME_OID, identity);
  driver.types.setTypeParser(TIMESTAMP_OID, identity);
  driver.types.setTypeParser(TIMESTAMPTZ_OID, identity);
  applied = true;
}

module.exports = { applyDateTypeParsers, DATE_OID, TIME_OID, TIMESTAMP_OID, TIMESTAMPTZ_OID };
