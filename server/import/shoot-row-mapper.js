'use strict';

const crypto = require('crypto');
const { mapHeaders } = require('./header-mapper');
const { parseDate, parseTime, parseMoney, parseStatus, parsePaid } = require('./values');
const { DEFAULT_SHOOT_STATUS } = require('../domain/shoot-status');

/**
 * Turns a raw table (headers + cells) into shoot records ready for import.
 *
 * Knows nothing about files, HTTP or SQL: give it a table, get rows and a list
 * of problems back.
 */
class ShootRowMapper {
  /** @param {{ hash?: (input: string) => string }} [deps] injectable for deterministic tests */
  constructor({ hash } = {}) {
    this.hash = hash || ((input) => crypto.createHash('md5').update(input).digest('hex'));
  }

  /**
   * @param {{ headers: string[], data: string[][] }} table
   * @returns {{ rows: object[], unmapped: string[], problems: { row: number, reason: string }[] }}
   */
  map(table) {
    const { headers, data } = table;
    const { mapping, unmapped } = mapHeaders(headers);
    const mappedIndexes = new Set(Object.values(mapping));
    const rows = [];
    const problems = [];

    data.forEach((cells, index) => {
      const cell = (field) => {
        const columnIndex = mapping[field];
        return columnIndex === undefined ? '' : String(cells[columnIndex] ?? '').trim();
      };

      const shootDate = parseDate(cell('shoot_date'));
      if (!shootDate) {
        problems.push({
          row: index + 2, // +1 for the header row, +1 because sheets are 1-based
          reason: `no parsable date in column "${headers[mapping.shoot_date] || '(none)'}"`
        });
        return;
      }

      const fee = parseMoney(cell('fee'));
      const status = parseStatus(cell('status'));
      const client = cell('client_name') || null;
      const type = cell('shoot_type') || null;

      let endDate = parseDate(cell('end_date'));
      if (endDate && endDate < shootDate) endDate = shootDate;

      const title = cell('title') || ShootRowMapper.#fallbackTitle({ client, type, shootDate });

      let paid = parsePaid(cell('paid'), fee);
      if (paid === null) paid = status === 'completed' ? fee || 0 : 0;

      rows.push({
        title,
        client_name: client,
        shoot_type: type,
        shoot_date: shootDate,
        end_date: endDate,
        start_time: parseTime(cell('start_time')),
        end_time: parseTime(cell('end_time')),
        venue: cell('venue') || null,
        location: cell('location') || null,
        coordinator: cell('coordinator') || null,
        fee: fee || 0,
        status: status || DEFAULT_SHOOT_STATUS,
        contact_name: cell('contact_name') || null,
        contact_phone: cell('contact_phone') || null,
        notes: cell('notes') || null,
        payments: paid ? [{ amount: paid, method: null, note: 'from import', paid_on: shootDate }] : [],
        extra: ShootRowMapper.#collectExtra(headers, cells, mappedIndexes),
        dedupe_hash: this.#dedupeHash({ title, shootDate, client, fee })
      });
    });

    return { rows, unmapped, problems };
  }

  static #fallbackTitle({ client, type, shootDate }) {
    const parts = [client, type].filter(Boolean);
    return parts.length ? parts.join(' – ') : `Shoot on ${shootDate}`;
  }

  /** Columns the mapper did not recognise are preserved verbatim in `extra`. */
  static #collectExtra(headers, cells, mappedIndexes) {
    const extra = {};
    headers.forEach((header, index) => {
      const value = String(cells[index] ?? '').trim();
      if (header && !mappedIndexes.has(index) && value !== '') extra[header] = value;
    });
    return extra;
  }

  /** Stable fingerprint that makes re-imports idempotent. */
  #dedupeHash({ title, shootDate, client, fee }) {
    return this.hash(`${title.toLowerCase()}|${shootDate}|${(client || '').toLowerCase()}|${fee || 0}`);
  }
}

module.exports = { ShootRowMapper };
