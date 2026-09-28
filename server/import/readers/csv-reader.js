'use strict';

const { normalizeHeader } = require('../header-mapper');
const { CSV } = require('../format-detector');

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–' };

/** Sheets exported to CSV sometimes keep HTML entities in their cells. */
function decodeEntities(value) {
  return value.replace(/&(\w+);/g, (match, name) => {
    const decoded = ENTITIES[String(name).toLowerCase()];
    return decoded === undefined ? match : decoded;
  });
}

/** Pick the separator that occurs most often in the header line. */
function detectDelimiter(text) {
  const firstLine = String(text).split(/\r?\n/, 1)[0] || '';
  const candidates = [',', '\t', ';', '|'];
  let best = ',';
  let bestCount = -1;
  for (const candidate of candidates) {
    const count = firstLine.split(candidate).length - 1;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return bestCount > 0 ? best : ',';
}

/**
 * RFC-4180-ish delimited text reader (comma, tab, semicolon or pipe).
 *
 * @implements {import('./table-reader').TableReader}
 */
class CsvTableReader {
  get format() {
    return CSV;
  }

  /** @returns {{ headers: string[], data: string[][] }} */
  read(text) {
    const source = String(text);
    const delimiter = detectDelimiter(source);
    const rows = [];
    let row = [];
    let cell = '';
    let inQuotes = false;

    for (let i = 0; i < source.length; i++) {
      const char = source[i];
      if (inQuotes) {
        if (char === '"') {
          if (source[i + 1] === '"') {
            cell += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          cell += char;
        }
      } else if (char === '"') {
        inQuotes = true;
      } else if (char === delimiter) {
        row.push(cell);
        cell = '';
      } else if (char === '\n' || char === '\r') {
        if (char === '\r' && source[i + 1] === '\n') i++;
        row.push(cell);
        cell = '';
        rows.push(row);
        row = [];
      } else {
        cell += char;
      }
    }
    if (cell !== '' || row.length) {
      row.push(cell);
      rows.push(row);
    }

    const cleaned = rows
      .map((cells) => cells.map((value) => decodeEntities(String(value).trim())))
      .filter((cells) => cells.some((value) => value !== ''));
    if (!cleaned.length) return { headers: [], data: [] };
    return { headers: cleaned[0].map(normalizeHeader), data: cleaned.slice(1) };
  }
}

module.exports = { CsvTableReader, detectDelimiter, decodeEntities };
