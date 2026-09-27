'use strict';

const LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };

/**
 * Minimal leveled logger.
 *
 * Modules depend on this small interface (`error/warn/info/debug/child`) rather
 * than on `console`, so tests can inject a silent or recording logger and a
 * different sink (file, JSON transport, …) can be dropped in later without
 * touching call sites.
 *
 * @param {{ level?: keyof LEVELS, scope?: string, sink?: Console, timestamps?: boolean }} [options]
 */
function createLogger(options = {}) {
  const level = LEVELS[options.level] !== undefined ? LEVELS[options.level] : LEVELS.info;
  const sink = options.sink || console;
  const scope = options.scope || '';
  const timestamps = options.timestamps !== false;

  const emit = (method, levelName, args) => {
    if (LEVELS[levelName] > level) return;
    const prefix = [timestamps ? new Date().toISOString() : null, scope ? `[${scope}]` : null]
      .filter(Boolean)
      .join(' ');
    if (prefix) sink[method](prefix, ...args);
    else sink[method](...args);
  };

  return {
    level: options.level || 'info',
    error: (...args) => emit('error', 'error', args),
    warn: (...args) => emit('warn', 'warn', args),
    info: (...args) => emit('log', 'info', args),
    debug: (...args) => emit('log', 'debug', args),
    /** Derive a logger for a sub-system: `logger.child('db')` → `[db] …`. */
    child: (childScope) =>
      createLogger({ ...options, sink, scope: scope ? `${scope}:${childScope}` : childScope })
  };
}

/** A logger that swallows everything — handy in tests. */
const silentLogger = createLogger({ level: 'silent' });

module.exports = { createLogger, silentLogger, LEVELS };
