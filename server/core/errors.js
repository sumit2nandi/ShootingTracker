'use strict';

/**
 * Application error hierarchy.
 *
 * Every layer below HTTP throws these instead of returning ad-hoc shapes or
 * leaking driver errors. The HTTP error handler is then the *only* place that
 * knows about status codes and response bodies (single responsibility), and it
 * can decide safely what may be shown to a client (`expose`).
 */
class AppError extends Error {
  /**
   * @param {string} message human readable message
   * @param {{ status?: number, code?: string, expose?: boolean, cause?: Error, details?: unknown }} [options]
   */
  constructor(message, options = {}) {
    super(message);
    this.name = new.target.name;
    this.status = options.status || 500;
    this.code = options.code || 'internal_error';
    // `expose` decides whether `message` may travel to the client.
    this.expose = options.expose !== undefined ? options.expose : this.status < 500;
    this.details = options.details;
    if (options.cause) this.cause = options.cause;
    Error.captureStackTrace(this, new.target);
  }
}

class ValidationError extends AppError {
  constructor(message, details) {
    super(message, { status: 400, code: 'validation_error', details });
  }
}

class UnauthorizedError extends AppError {
  constructor(message = 'Sign-in required') {
    super(message, { status: 401, code: 'unauthorized' });
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'Not allowed') {
    super(message, { status: 403, code: 'forbidden' });
  }
}

class NotFoundError extends AppError {
  constructor(message = 'not found') {
    super(message, { status: 404, code: 'not_found' });
  }
}

class ConflictError extends AppError {
  constructor(message, details) {
    super(message, { status: 409, code: 'conflict', details });
  }
}

class ServiceUnavailableError extends AppError {
  constructor(message, options = {}) {
    super(message, { status: 503, code: 'service_unavailable', expose: true, ...options });
  }
}

/** Thrown while reading configuration; never rendered to a client. */
class ConfigurationError extends AppError {
  constructor(message) {
    super(message, { status: 500, code: 'configuration_error', expose: false });
  }
}

module.exports = {
  AppError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  ServiceUnavailableError,
  ConfigurationError
};
