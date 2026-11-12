import { ZodError } from 'zod';

/** An error with an HTTP status and a stable machine-readable code, safe to show to clients. */
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(message = 'Invalid request', details) {
    return new AppError(400, 'BAD_REQUEST', message, details);
  }

  static unauthorized(message = 'Authentication required') {
    return new AppError(401, 'UNAUTHORIZED', message);
  }

  static forbidden(message = 'Not allowed') {
    return new AppError(403, 'FORBIDDEN', message);
  }

  static notFound(message = 'Not found') {
    return new AppError(404, 'NOT_FOUND', message);
  }

  static conflict(message = 'Conflict', details) {
    return new AppError(409, 'CONFLICT', message, details);
  }
}

/** Mounted after all routes: any request that reaches it matched nothing. */
export function notFoundHandler(req, _res, next) {
  next(AppError.notFound(`No route for ${req.method} ${req.path}`));
}

/**
 * The single place errors become HTTP responses.
 * Response shape: { error: { code, message, details? } }
 */
export function createErrorHandler({ logger = console, exposeStack = false } = {}) {
  // Express identifies error middleware by its four parameters.
  return function errorHandler(err, _req, res, _next) {
    const { status, body } = toResponse(err);

    if (status >= 500) {
      logger.error(err);
      if (exposeStack && err instanceof Error) body.error.stack = err.stack;
    }

    res.status(status).json(body);
  };
}

function toResponse(err) {
  if (err instanceof AppError) {
    const error = { code: err.code, message: err.message };
    if (err.details !== undefined) error.details = err.details;
    return { status: err.status, body: { error } };
  }

  if (err instanceof ZodError) {
    const details = err.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    return {
      status: 400,
      body: { error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details } },
    };
  }

  // Errors raised by body parsing and similar middleware carry their own 4xx status.
  const status = err?.status ?? err?.statusCode;
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    return {
      status,
      body: { error: { code: 'BAD_REQUEST', message: err.expose ? err.message : 'Bad request' } },
    };
  }

  // Anything else is a bug or an outage: never leak internals to the client.
  return {
    status: 500,
    body: { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } },
  };
}
