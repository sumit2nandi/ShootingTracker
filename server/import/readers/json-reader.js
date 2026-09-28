'use strict';

const { JSON_FORMAT } = require('../format-detector');

/**
 * Reads an array of objects (or `{ rows: [...] }`) as a table.
 *
 * Keys are used verbatim as headers so the header mapper sees the same shape it
 * gets from CSV and HTML.
 *
 * @implements {import('./table-reader').TableReader}
 */
class JsonTableReader {
  get format() {
    return JSON_FORMAT;
  }

  /** @returns {{ headers: string[], data: string[][] }} */
  read(text) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { headers: [], data: [] };
    }
    if (parsed && !Array.isArray(parsed) && Array.isArray(parsed.rows)) parsed = parsed.rows;
    if (!Array.isArray(parsed) || !parsed.length) return { headers: [], data: [] };

    const headers = [];
    for (const entry of parsed) {
      if (entry && typeof entry === 'object') {
        for (const key of Object.keys(entry)) if (!headers.includes(key)) headers.push(key);
      }
    }
    const data = parsed.map((entry) =>
      entry && typeof entry === 'object'
        ? headers.map((header) => (entry[header] === undefined ? '' : String(entry[header])))
        : []
    );
    return { headers, data };
  }
}

module.exports = { JsonTableReader };
