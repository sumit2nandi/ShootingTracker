'use strict';

const { HtmlTableReader } = require('./html-table-reader');
const { CsvTableReader } = require('./csv-reader');
const { JsonTableReader } = require('./json-reader');
const { CSV } = require('../format-detector');

/**
 * @typedef {object} TableReader
 * @property {string} format the format this reader handles
 * @property {(text: string) => { headers: string[], data: string[][] }} read
 */

/**
 * Chooses the reader for a format.
 *
 * Readers are interchangeable (same input, same output shape), so supporting
 * XLSX or Markdown tables later means registering one more reader — the parser
 * and everything above it stay untouched.
 */
class TableReaderRegistry {
  /** @param {TableReader[]} [readers] */
  constructor(readers = []) {
    /** @type {Map<string, TableReader>} */
    this.readers = new Map();
    readers.forEach((reader) => this.register(reader));
  }

  /** @param {TableReader} reader */
  register(reader) {
    this.readers.set(reader.format, reader);
    return this;
  }

  /** @returns {TableReader} the matching reader, falling back to delimited text. */
  resolve(format) {
    return this.readers.get(format) || this.readers.get(CSV);
  }

  get formats() {
    return [...this.readers.keys()];
  }

  /** The registry the application runs with. */
  static createDefault() {
    return new TableReaderRegistry([new HtmlTableReader(), new CsvTableReader(), new JsonTableReader()]);
  }
}

module.exports = { TableReaderRegistry, HtmlTableReader, CsvTableReader, JsonTableReader };
