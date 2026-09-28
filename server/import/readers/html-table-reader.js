'use strict';

const cheerio = require('cheerio');
const { normalizeHeader } = require('../header-mapper');
const { HTML } = require('../format-detector');

/**
 * Reads the largest `<table>` out of an HTML spreadsheet export.
 *
 * @implements {import('./table-reader').TableReader}
 */
class HtmlTableReader {
  get format() {
    return HTML;
  }

  /** @returns {{ headers: string[], data: string[][] }} */
  read(text) {
    const $ = cheerio.load(text);
    // Plain JS arrays for row/cell collection: cheerio's `.map()` flattens
    // array return values, which would destroy the row structure.
    const tables = $('table')
      .get()
      .map((table) => {
        const rows = $(table)
          .find('tr')
          .get()
          .map((tr) =>
            $(tr)
              .find('th, td')
              .map((_index, cell) => $(cell).text().trim())
              .get()
          );
        return rows.filter((row) => Array.isArray(row) && row.some((cell) => cell && cell.trim() !== ''));
      });

    // A spreadsheet export may carry chrome tables; the real data is the biggest one.
    tables.sort((a, b) => b.length - a.length);
    const rows = tables[0] || [];
    if (!rows.length) return { headers: [], data: [] };
    return { headers: rows[0].map(normalizeHeader), data: rows.slice(1) };
  }
}

module.exports = { HtmlTableReader };
