'use strict';

const { ValidationError } = require('../core/errors');

const BODY_HINT = 'send raw file content as body, or JSON { content, format, dryRun }';

/**
 * Orchestrates "a sheet arrives" → "rows are parsed" → "rows are stored".
 *
 * Parsing (pure) and importing (transactional) are separate collaborators, so a
 * dry run genuinely cannot touch the database: it simply never reaches the
 * importer.
 */
class ImportService {
  /**
   * @param {{ sheetParser: import('../import/sheet-parser').SheetParser,
   *           shootImporter: import('./shoot-importer').ShootImporter }} deps
   */
  constructor({ sheetParser, shootImporter }) {
    this.sheetParser = sheetParser;
    this.shootImporter = shootImporter;
  }

  /**
   * Normalize the several shapes the endpoint accepts (raw text body, or JSON
   * with `content`/`text`/`file`).
   *
   * @param {unknown} body
   * @returns {{ content: string, format?: string, dryRun: boolean }}
   */
  static readRequest(body) {
    let content = typeof body === 'string' ? body : body && (body.content || body.text || body.file);
    if (content === undefined || content === null) throw new ValidationError(BODY_HINT);
    if (typeof content !== 'string') content = JSON.stringify(content);

    const options = typeof body === 'object' && body !== null ? body : {};
    return {
      content,
      format: options.format || options.type || undefined,
      dryRun: options.dryRun === true || options.dryRun === 'true'
    };
  }

  /**
   * @param {{ content: string, format?: string, dryRun?: boolean }} request
   * @returns {Promise<object>} the API payload for `POST /api/import`
   */
  async execute({ content, format, dryRun = false }) {
    const parsed = this.sheetParser.parse(content, format);

    if (dryRun) {
      return {
        dryRun: true,
        format: parsed.format,
        rows: parsed.rows,
        unmapped: parsed.unmapped,
        problems: parsed.problems,
        count: parsed.rows.length
      };
    }

    const result = await this.shootImporter.import(parsed.rows);
    return { dryRun: false, format: parsed.format, ...result, unmapped: parsed.unmapped };
  }
}

module.exports = { ImportService, BODY_HINT };
