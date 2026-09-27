'use strict';

const HTML = 'html';
const CSV = 'csv';
const JSON_FORMAT = 'json';

const SUPPORTED_FORMATS = Object.freeze([HTML, CSV, JSON_FORMAT]);

const stripBom = (text) => String(text === null || text === undefined ? '' : text).replace(/^\uFEFF/, '');

/**
 * Guess the format of a pasted/uploaded sheet.
 *
 * Pure and side-effect free, so both the HTTP endpoint and the CLI can use it,
 * and its behaviour is covered by unit tests.
 *
 * @param {string} text
 * @returns {'html'|'csv'|'json'}
 */
function detectFormat(text) {
  const trimmed = stripBom(text).trim();
  if (!trimmed) return CSV;
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) return JSON_FORMAT;
  if (/<table[\s>]/i.test(trimmed) || /<html/i.test(trimmed)) return HTML;
  return CSV;
}

module.exports = { detectFormat, stripBom, SUPPORTED_FORMATS, HTML, CSV, JSON_FORMAT };
