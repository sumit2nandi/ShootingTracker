'use strict';

const { ConflictError, ValidationError } = require('../core/errors');

/**
 * SQLSTATE → application error.
 *
 * Keeps driver specifics inside the persistence layer: services and routes
 * react to `ConflictError` / `ValidationError`, not to `error.code === '23505'`,
 * and raw driver text never reaches a client.
 */
const TRANSLATIONS = {
  '23505': (error, context) => new ConflictError(context.conflictMessage || 'That value already exists', { cause: error }),
  '23503': () => new ValidationError('A referenced record does not exist'),
  '23502': () => new ValidationError('A required field is missing'),
  '23514': () => new ValidationError('A value is outside the range this field allows'),
  '22001': () => new ValidationError('A value is too long for its field'),
  '22003': () => new ValidationError('A number is out of range'),
  '22007': () => new ValidationError('Invalid date or time value'),
  '22008': () => new ValidationError('Invalid date or time value'),
  '22P02': () => new ValidationError('Invalid value for a numeric, date or JSON field')
};

/**
 * @param {Error & { code?: string }} error
 * @param {{ conflictMessage?: string }} [context]
 * @returns {Error} a domain error when the code is known, otherwise the original
 */
function translatePgError(error, context = {}) {
  const translate = error && error.code ? TRANSLATIONS[error.code] : null;
  return translate ? translate(error, context) : error;
}

/** Run `work`, translating any driver error it throws. */
async function withTranslatedErrors(work, context = {}) {
  try {
    return await work();
  } catch (error) {
    throw translatePgError(error, context);
  }
}

module.exports = { translatePgError, withTranslatedErrors };
