'use strict';

const { TableReaderRegistry } = require('./readers');
const { ShootRowMapper } = require('./shoot-row-mapper');
const { detectFormat, stripBom } = require('./format-detector');

/**
 * Sheet → shoot rows.
 *
 * Composed from two collaborators it does not construct itself: a reader
 * registry (how bytes become a table) and a row mapper (how a table becomes
 * shoots). Either can be replaced in tests or extended without editing this
 * class.
 */
class SheetParser {
  /** @param {{ readers?: TableReaderRegistry, rowMapper?: ShootRowMapper }} [deps] */
  constructor({ readers, rowMapper } = {}) {
    this.readers = readers || TableReaderRegistry.createDefault();
    this.rowMapper = rowMapper || new ShootRowMapper();
  }

  /**
   * @param {string} text raw sheet content
   * @param {string} [format] one of html/csv/json; detected when omitted
   * @returns {{ rows: object[], unmapped: string[], problems: { row: number, reason: string }[], format: string }}
   */
  parse(text, format) {
    const content = stripBom(text); // Google Sheets exports start with a BOM
    const resolvedFormat = format || detectFormat(content);
    const table = this.readers.resolve(resolvedFormat).read(content);

    if (!table.headers.length) {
      return { rows: [], unmapped: [], problems: [{ row: 0, reason: 'no table rows found' }], format: resolvedFormat };
    }
    return { ...this.rowMapper.map(table), format: resolvedFormat };
  }
}

module.exports = { SheetParser };
