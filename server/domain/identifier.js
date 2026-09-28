'use strict';

const { ValidationError } = require('../core/errors');

/**
 * Parse a path/query identifier into a positive integer.
 *
 * Doing this at the edge of the domain means an id like `abc` fails as a clear
 * 400 instead of reaching Postgres and surfacing as a 500 with driver text.
 *
 * @param {unknown} value
 * @param {string} [label] used in the error message
 * @returns {number}
 */
function parseId(value, label = 'id') {
  const text = String(value === undefined || value === null ? '' : value).trim();
  if (!/^\d+$/.test(text)) throw new ValidationError(`${label} must be a positive integer`);
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new ValidationError(`${label} must be a positive integer`);
  return parsed;
}

module.exports = { parseId };
